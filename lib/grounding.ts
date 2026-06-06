import type { Evidence, GroundingResult } from "@/lib/chat";
import { evidenceText, overlapScore, supportBand } from "@/lib/web-agent";

export function judgeGrounding(
  question: string,
  answer: string,
  evidence: Evidence[],
): GroundingResult {
  if (evidence.length === 0) {
    return {
      passed: false,
      groundingScore: 0,
      supportBand: "weak",
      unsupportedFacts: [],
      reason: "Model-only answer; no evidence was available for grounding.",
    };
  }

  const supportText = evidenceText(evidence);
  const retrievalConfidence = averageEvidenceConfidence(evidence);
  const questionOverlap = overlapScore(question, supportText);
  const answerOverlap = overlapScore(answer, supportText);
  const groundingScore = clamp(
    0.6 * retrievalConfidence + 0.25 * questionOverlap + 0.15 * answerOverlap,
  );
  const unsupportedFacts = extractHighRiskFacts(answer).filter(
    (fact) => !isFactSupported(fact, supportText),
  );
  const passed = groundingScore >= 0.52 && unsupportedFacts.length === 0;

  return {
    passed,
    groundingScore,
    supportBand: supportBand(groundingScore),
    unsupportedFacts,
    reason: passed
      ? "The answer is supported by accepted evidence."
      : "One or more exact facts are weakly supported or missing from accepted evidence.",
  };
}

export function shouldKeepRepair(
  before: GroundingResult,
  after: GroundingResult,
) {
  if (after.unsupportedFacts.length > before.unsupportedFacts.length) {
    return false;
  }

  return (
    after.unsupportedFacts.length < before.unsupportedFacts.length ||
    after.groundingScore > before.groundingScore
  );
}

function averageEvidenceConfidence(evidence: Evidence[]) {
  if (evidence.length === 0) {
    return 0;
  }

  const total = evidence.reduce(
    (sum, item) => sum + (item.supportScore ?? item.confidence ?? 0),
    0,
  );

  return clamp(total / evidence.length);
}

function extractHighRiskFacts(answer: string) {
  const facts = new Set<string>();
  const patterns = [
    /\b(?:19|20)\d{2}\b/g,
    /\b\d+(?:\.\d+)?\s*%/g,
    /\b\d+(?:\.\d+)?\b/g,
    /\b[A-Z]{2,5}\d{3,5}\b/g,
    /https?:\/\/[^\s)]+/g,
    /\b(?:Bachelor|Master|Doctor|PhD|Programme|Program)[A-Za-z0-9()&,\-\s]{4,80}/g,
    /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,5}\s+(?:Lab|Laboratory|Facility|Centre|Center|Unit|Office)\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of answer.matchAll(pattern)) {
      const fact = match[0].trim().replace(/[.,;:]$/, "");

      if (isListMarker(answer, match.index ?? -1, fact)) {
        continue;
      }

      if (fact.length > 1 || /^\d$/.test(fact)) {
        facts.add(fact);
      }
    }
  }

  return Array.from(facts).slice(0, 12);
}

function isListMarker(answer: string, index: number, fact: string) {
  if (index < 0 || !/^\d{1,2}$/.test(fact)) {
    return false;
  }

  return (
    /(?:^|\n)[ \t]*$/.test(answer.slice(0, index)) &&
    /^[.)]/.test(answer.slice(index + fact.length))
  );
}

function isFactSupported(fact: string, supportText: string) {
  const normalizedFact = normalize(fact);
  const normalizedSupport = normalize(supportText);

  if (/^\d+(?:\.\d+)?%?$/.test(normalizedFact)) {
    return hasExactNumericFact(normalizedFact, normalizedSupport);
  }

  if (normalizedSupport.includes(normalizedFact)) {
    return true;
  }

  const factTerms = normalizedFact
    .split(" ")
    .filter((term) => term.length > 2);

  if (factTerms.length < 3) {
    return false;
  }

  const hits = factTerms.filter((term) => normalizedSupport.includes(term));

  return hits.length / factTerms.length >= 0.8;
}

function hasExactNumericFact(fact: string, supportText: string) {
  const numericTokens =
    supportText.match(/\d+(?:\.\d+)?%?/g) ?? ([] as string[]);

  return numericTokens.includes(fact);
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.%/:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
