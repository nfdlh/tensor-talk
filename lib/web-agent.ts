import type {
  Evidence,
  PlannerTrace,
  RejectedEvidence,
  WebTrustMode,
} from "@/lib/chat";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const SEARCH_TIMEOUT_MS = 25_000;
const WEB_PROMPT_TEXT_LIMIT = 1_200;

export const ALLOWED_WEB_DOMAINS = [
  "fsktm.um.edu.my",
  "um.edu.my",
  "www.um.edu.my",
  "umresearch.um.edu.my",
  "umlib.um.edu.my",
  "maya.um.edu.my",
  "career.um.edu.my",
  "study.um.edu.my",
  "admission.um.edu.my",
  "umexpert.um.edu.my",
  "ias.um.edu.my",
] as const;

const BROAD_WEB_DOMAINS = ["um.edu.my", "*.um.edu.my"] as const;

const BLOCKED_FILE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "ico",
  "js",
  "css",
  "zip",
  "rar",
  "7z",
  "mp4",
  "mp3",
  "wav",
  "mov",
  "ppt",
  "pptx",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "woff",
  "woff2",
  "ttf",
  "otf",
]);

const BLOCKED_TEXT_PATTERNS = [
  /\baccess denied\b/i,
  /\b403 forbidden\b/i,
  /\brequest blocked\b/i,
  /\bcaptcha\b/i,
  /\benable javascript\b/i,
  /\bcloudflare\b/i,
  /\bwaf\b/i,
];

const FAKE_URL_PATTERNS = [
  /\bexample\.(?:com|org|net)\b/i,
  /\blocalhost\b/i,
  /\b127\.0\.0\.1\b/i,
  /\bfake\b/i,
  /\bdummy\b/i,
  /\bplaceholder\b/i,
  /\binvalid\b/i,
];

type ExaResult = {
  title?: string;
  url?: string;
  id?: string;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
  score?: number;
};

type ExaSearchResponse = {
  results?: ExaResult[];
  requestId?: string;
  error?: {
    message?: string;
  };
};

export type WebSearchResult = {
  evidence: Evidence[];
  rejected: RejectedEvidence[];
  searchedUrls: string[];
  requestId?: string;
};

export async function searchOfficialWeb(
  question: string,
  planner: Pick<PlannerTrace, "searchQueries" | "targetKeywords">,
  trustMode: WebTrustMode = "broad",
  abortSignal?: AbortSignal,
): Promise<WebSearchResult> {
  const apiKey = process.env.EXA_API_KEY;

  if (!apiKey) {
    throw new Error("Missing EXA_API_KEY.");
  }

  const query = buildSearchQuery(question, planner);
  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 8,
      includeDomains: getSearchDomains(trustMode),
      contents: {
        highlights: true,
        text: {
          maxCharacters: 3000,
        },
      },
    }),
    signal: createSearchSignal(abortSignal),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Exa search request timed out.");
    }

    throw error;
  });
  const body = (await response
    .json()
    .catch(() => null)) as ExaSearchResponse | null;

  if (!response.ok) {
    throw new Error(
      body?.error?.message ?? `Exa search failed with ${response.status}.`,
    );
  }

  const results = body?.results ?? [];
  const searchedUrls = results
    .map((result) => result.url)
    .filter((url): url is string => Boolean(url));
  const rejected: RejectedEvidence[] = [];
  const evidence: Evidence[] = [];

  for (const [index, result] of results.entries()) {
    if (!result.url) {
      continue;
    }

    const decision = inspectWebResult(result, question, trustMode, index + 1);

    if (!decision.accepted) {
      rejected.push(decision.rejected);
      continue;
    }

    evidence.push(decision.evidence);

    if (evidence.length >= 3) {
      break;
    }
  }

  return {
    evidence,
    rejected,
    searchedUrls,
    requestId: body?.requestId,
  };
}

function createSearchSignal(abortSignal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);

  return abortSignal
    ? AbortSignal.any([abortSignal, timeoutSignal])
    : timeoutSignal;
}

export function deterministicPlanner(
  question: string,
  localEvidence: Evidence[],
): PlannerTrace {
  const needWeb = shouldUseWebDeterministically(question, localEvidence);

  return {
    needWeb,
    queryType: needWeb ? "official_web" : "handbook_or_model",
    answerFocus: needWeb
      ? "Find official UM or FSKTM page evidence."
      : "Use local handbook evidence or model knowledge.",
    targetKeywords: meaningfulTerms(question).slice(0, 8),
    searchQueries: [question],
    reason: needWeb
      ? "The question appears to need current or official web evidence, or local evidence is weak."
      : "The question looks stable and local evidence is sufficient.",
    source: "deterministic",
  };
}

export function applyDeterministicWebGuard(
  planner: PlannerTrace,
  question: string,
  localEvidence: Evidence[],
): PlannerTrace {
  const deterministic = deterministicPlanner(question, localEvidence);

  if (planner.needWeb || !deterministic.needWeb) {
    return planner;
  }

  return {
    ...planner,
    needWeb: true,
    queryType: deterministic.queryType,
    answerFocus: deterministic.answerFocus,
    targetKeywords: uniqueStrings([
      ...planner.targetKeywords,
      ...deterministic.targetKeywords,
    ]).slice(0, 8),
    searchQueries:
      planner.searchQueries.length > 0
        ? planner.searchQueries
        : deterministic.searchQueries,
    reason: `${planner.reason} Deterministic guard required official web evidence: ${deterministic.reason}`,
  };
}

export function shouldUseWebDeterministically(
  question: string,
  localEvidence: Evidence[],
) {
  const normalized = question.toLowerCase();
  const currentIntent =
    /\b(latest|current|today|now|new|recent|deadline|fee|fees|intake|apply|admission|contact|email|phone|announcement|event|news|opening hours?)\b/.test(
      normalized,
    );
  const pageIntent =
    /\b(lab|laboratory|facility|programme|program|staff|pekom|research|career|library|portal|website|url|link|page)\b/.test(
      normalized,
    );
  const localWeak =
    localEvidence.length === 0 ||
    Math.max(0, ...localEvidence.map((item) => item.supportScore ?? 0)) < 0.52;

  return currentIntent || pageIntent || localWeak;
}

export function supportBand(score: number): "strong" | "moderate" | "weak" {
  if (score >= 0.72) {
    return "strong";
  }

  if (score >= 0.52) {
    return "moderate";
  }

  return "weak";
}

export function validateOfficialUrl(
  url: string,
  trustMode: WebTrustMode = "broad",
):
  | {
      accepted: true;
      domain: string;
      sourceKind: "page" | "pdf";
    }
  | {
      accepted: false;
      reason: RejectedEvidence["reason"];
      domain?: string;
    } {
  const parsed = parseSafeUrl(url);

  if (!parsed) {
    return { accepted: false, reason: "fake_url_pattern" };
  }

  const domain = parsed.hostname;

  if (!isAllowedDomain(domain, trustMode)) {
    return { accepted: false, reason: "domain_not_allowed", domain };
  }

  if (isFakeUrl(url)) {
    return { accepted: false, reason: "fake_url_pattern", domain };
  }

  if (isBlockedAsset(parsed)) {
    return { accepted: false, reason: "asset_url", domain };
  }

  return {
    accepted: true,
    domain,
    sourceKind: parsed.pathname.toLowerCase().endsWith(".pdf") ? "pdf" : "page",
  };
}

export function evidenceText(evidence: Evidence[]) {
  return evidence
    .flatMap((item) => [
      item.title,
      item.section,
      item.subsection,
      item.snippet,
      item.source_text,
      item.pages?.join(" "),
      ...(item.highlights ?? []),
      item.url,
    ])
    .filter(Boolean)
    .join("\n");
}

export function overlapScore(left: string, right: string) {
  const leftTerms = meaningfulTerms(left);

  if (leftTerms.length === 0) {
    return 0;
  }

  const rightTerms = new Set(meaningfulTerms(right));
  const hits = leftTerms.filter((term) => rightTerms.has(term)).length;

  return clamp(hits / leftTerms.length);
}

function buildSearchQuery(
  question: string,
  planner: Pick<PlannerTrace, "searchQueries" | "targetKeywords">,
) {
  const query = planner.searchQueries.find((item) => item.trim()) ?? question;
  const keywords = planner.targetKeywords.slice(0, 4).join(" ");

  return [query, keywords, "Universiti Malaya FSKTM official"]
    .filter(Boolean)
    .join(" ");
}

function inspectWebResult(
  result: ExaResult,
  question: string,
  trustMode: WebTrustMode,
  rank: number,
):
  | { accepted: true; evidence: Evidence }
  | { accepted: false; rejected: RejectedEvidence } {
  const url = result.url ?? "";
  const title = result.title?.trim() || "Official UM web source";
  const urlDecision = validateOfficialUrl(url, trustMode);

  if (!urlDecision.accepted) {
    return {
      accepted: false,
      rejected: {
        title,
        url,
        domain: urlDecision.domain,
        reason: urlDecision.reason,
      },
    };
  }

  const { domain } = urlDecision;
  const baseRejected = { title, url, domain };

  const highlights = (result.highlights ?? [])
    .map((highlight) => highlight.trim())
    .filter(Boolean)
    .slice(0, 4);
  const rawText = [highlights.join("\n"), result.text ?? ""].join("\n").trim();

  if (
    !rawText ||
    BLOCKED_TEXT_PATTERNS.some((pattern) => pattern.test(rawText))
  ) {
    return {
      accepted: false,
      rejected: { ...baseRejected, reason: "blocked_or_empty" },
    };
  }

  const relevance = overlapScore(question, rawText);
  const hasScoredSignal =
    typeof result.score === "number" || Boolean(result.highlightScores?.length);

  if (!hasScoredSignal && relevance < 0.08) {
    return {
      accepted: false,
      rejected: { ...baseRejected, reason: "low_relevance" },
    };
  }

  const confidence = webConfidence(result, relevance, rank);
  const supportScoreValue = clamp(0.75 * confidence + 0.25 * relevance);

  if (supportScoreValue < 0.32) {
    return {
      accepted: false,
      rejected: { ...baseRejected, reason: "low_relevance" },
    };
  }

  return {
    accepted: true,
    evidence: {
      kb_id: `web-${rank}-${stableId(url)}`,
      sourceType: "web",
      source_doc: domain,
      title,
      url,
      domain,
      sourceKind: urlDecision.sourceKind,
      snippet: rawText.slice(0, 360),
      highlights,
      source_text: rawText.slice(0, WEB_PROMPT_TEXT_LIMIT),
      rank,
      confidence,
      supportScore: supportScoreValue,
      supportBand: supportBand(supportScoreValue),
      status: "accepted",
    },
  };
}

function parseSafeUrl(url: string) {
  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isAllowedDomain(hostname: string, trustMode: WebTrustMode) {
  if (trustMode === "broad") {
    return hostname === "um.edu.my" || hostname.endsWith(".um.edu.my");
  }

  return ALLOWED_WEB_DOMAINS.some(
    (domain) =>
      hostname === domain ||
      (domain === "fsktm.um.edu.my" && hostname.endsWith(`.${domain}`)),
  );
}

function getSearchDomains(trustMode: WebTrustMode) {
  return trustMode === "broad" ? BROAD_WEB_DOMAINS : ALLOWED_WEB_DOMAINS;
}

function isFakeUrl(url: string) {
  return FAKE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function isBlockedAsset(url: URL) {
  const extension = url.pathname.split(".").pop()?.toLowerCase();

  return Boolean(
    extension && extension !== "pdf" && BLOCKED_FILE_EXTENSIONS.has(extension),
  );
}

function webConfidence(result: ExaResult, relevance: number, rank: number) {
  const highlightScores = result.highlightScores ?? [];
  const highlightScore =
    highlightScores.length > 0
      ? highlightScores.reduce((sum, value) => sum + value, 0) /
        highlightScores.length
      : null;
  const base =
    typeof result.score === "number"
      ? result.score
      : (highlightScore ?? 0.25 + Math.max(0, 4 - rank) * 0.04);

  return clamp(base * 0.7 + relevance * 0.3);
}

function stableId(text: string) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function meaningfulTerms(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term)) ?? [],
    ),
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function clamp(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

const STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "can",
  "could",
  "does",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "me",
  "need",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
]);
