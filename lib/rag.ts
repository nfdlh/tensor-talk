import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";

export type HandbookEvidence = {
  kb_id: string;
  source_doc?: string;
  scope_label?: string;
  section?: string;
  subsection?: string;
  pages?: number[];
  source_text?: string;
  grounded_answer_bank?: string[];
};

type HandbookRow = HandbookEvidence & {
  id: number;
  title?: string;
  retrieval_text?: string;
  retrieval_keywords?: string[];
  group_canonical_questions?: string[];
  chunk_question_variants?: string[];
};

const STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "can",
  "could",
  "does",
  "give",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "list",
  "me",
  "many",
  "of",
  "on",
  "or",
  "need",
  "needed",
  "tell",
  "the",
  "there",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
]);

const ACRONYM_EXPANSIONS: Record<string, string[]> = {
  ai: ["artificial", "intelligence"],
};

const MIN_FUZZY_SCORE = 20;

let rowsCache: HandbookRow[] | null = null;
let searchCache: MiniSearch<HandbookRow> | null = null;

function loadKnowledgeBase() {
  if (rowsCache && searchCache) {
    return { rows: rowsCache, search: searchCache };
  }

  const filePath = path.join(
    process.cwd(),
    "data",
    "UM_RAG_Knowledge_Base.jsonl",
  );
  const file = fs.readFileSync(filePath, "utf8");
  const rows = file
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line, index) => ({
      ...(JSON.parse(line) as Omit<HandbookRow, "id">),
      id: index,
    }));

  const search = new MiniSearch<HandbookRow>({
    fields: [
      "title",
      "retrieval_text",
      "source_text",
      "section",
      "subsection",
      "scope_label",
    ],
    storeFields: [
      "kb_id",
      "source_doc",
      "scope_label",
      "section",
      "subsection",
      "pages",
      "source_text",
      "grounded_answer_bank",
    ],
    searchOptions: {
      boost: {
        title: 2,
        section: 2,
        subsection: 2,
        retrieval_text: 1.5,
      },
      fuzzy: 0.18,
      prefix: true,
    },
  });

  search.addAll(rows);
  rowsCache = rows;
  searchCache = search;

  return { rows, search };
}

export function retrieveContext(question: string, topK = 4): HandbookEvidence[] {
  const { rows, search } = loadKnowledgeBase();
  const query = question.trim();

  if (!query) {
    return [];
  }

  const queryTerms = meaningfulTerms(query);
  const subject = directQuestionSubject(query);
  const searchQuery = queryTerms.length > 0 ? queryTerms.join(" ") : query;
  const matches = search
    .search(searchQuery)
    .map((match) => ({
      row: rows[Number(match.id)],
      searchScore: match.score,
    }))
    .filter(
      (match): match is { row: HandbookRow; searchScore: number } =>
        Boolean(match.row) &&
        isRelevantMatch(match.row, queryTerms, match.searchScore),
    )
    .map((match) => ({
      ...match,
      score: contextScore(match.row, query, queryTerms, subject, match.searchScore),
    }))
    .sort((left, right) => right.score - left.score)
    .map((match) => match.row)
    .slice(0, topK);

  return matches.map(toEvidence);
}

function meaningfulTerms(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term))
        .flatMap((term) => ACRONYM_EXPANSIONS[term] ?? [term]) ?? [],
    ),
  );
}

function isRelevantMatch(
  row: HandbookRow | undefined,
  queryTerms: string[],
  score: number,
) {
  if (!row) {
    return false;
  }

  if (queryTerms.length === 0) {
    return true;
  }

  const haystack = searchableText(row);
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
  const requiredMatches = Math.ceil(queryTerms.length * 0.6);

  return score >= MIN_FUZZY_SCORE || matchedTerms.length >= requiredMatches;
}

function searchableText(row: HandbookRow) {
  return [
    row.title,
    row.retrieval_text,
    row.source_text,
    row.section,
    row.subsection,
    row.scope_label,
    ...(row.retrieval_keywords ?? []),
    ...(row.group_canonical_questions ?? []),
    ...(row.chunk_question_variants ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function contextScore(
  row: HandbookRow,
  question: string,
  queryTerms: string[],
  subject: string | null,
  searchScore: number,
) {
  const normalizedQuestion = normalizeText(question);
  const questions = [
    ...(row.group_canonical_questions ?? []),
    ...(row.chunk_question_variants ?? []),
  ].map(normalizeText);
  const questionScore = questions.includes(normalizedQuestion) ? 500 : 0;
  const answerScoreValue =
    Math.max(
      0,
      ...(row.grounded_answer_bank ?? []).map((answer) =>
        answerScore(answer, queryTerms, subject),
      ),
    ) * 25;
  const haystack = searchableText(row);
  const termScore =
    queryTerms.filter((term) => haystack.includes(term)).length * 4;

  if (!subject) {
    return searchScore + questionScore + answerScoreValue + termScore;
  }

  const definitionScore = haystack.includes(`definition of ${subject}`)
    ? 350
    : 0;
  const statementScore = haystack.includes(`${subject} is`) ? 250 : 0;

  return (
    searchScore +
    questionScore +
    answerScoreValue +
    definitionScore +
    statementScore +
    termScore
  );
}

function toEvidence(row: HandbookRow): HandbookEvidence {
  return {
    kb_id: row.kb_id,
    source_doc: row.source_doc,
    scope_label: row.scope_label,
    section: row.section,
    subsection: row.subsection,
    pages: row.pages,
    source_text: row.source_text,
    grounded_answer_bank: row.grounded_answer_bank,
  };
}

export function buildFallbackAnswer(
  evidence: HandbookEvidence[],
  question = "",
) {
  const firstAnswer = bestGroundedAnswer(evidence, question);

  if (firstAnswer) {
    return firstAnswer;
  }

  const firstText = evidence.find((item) => item.source_text)?.source_text;

  if (firstText) {
    return firstText.split(/\s+/).slice(0, 90).join(" ");
  }

  return "I could not find enough handbook evidence for that question.";
}

function bestGroundedAnswer(evidence: HandbookEvidence[], question: string) {
  const answers = evidence
    .flatMap((item) => item.grounded_answer_bank ?? [])
    .filter(Boolean);

  if (answers.length === 0) {
    return undefined;
  }

  const queryTerms = meaningfulTerms(question);
  const subject = directQuestionSubject(question);

  return answers
    .map((answer, index) => {
      const score = answerScore(answer, queryTerms, subject);

      return {
        answer,
        score,
        rankedScore: score - index * 0.001,
      };
    })
    .filter((answer) => answer.score >= minimumAnswerScore(queryTerms, subject))
    .sort((left, right) => right.rankedScore - left.rankedScore)[0]?.answer;
}

function answerScore(
  answer: string,
  queryTerms: string[],
  subject: string | null,
) {
  const normalized = answer.toLowerCase();
  const termScore = queryTerms.filter((term) => normalized.includes(term)).length;

  if (!subject) {
    return termScore;
  }

  const roleSubject = normalizeRoleSubject(subject);
  const directPatterns = [
    { pattern: `is listed as the ${roleSubject}`, score: 20 },
    { pattern: `is listed as ${roleSubject}`, score: 20 },
    { pattern: `is the ${roleSubject}`, score: 18 },
    { pattern: `is ${roleSubject}`, score: 16 },
    { pattern: `${subject} is`, score: 10 },
    { pattern: `${roleSubject} is`, score: 10 },
    { pattern: `as ${roleSubject}`, score: 6 },
  ];
  const directScore = Math.max(
    0,
    ...directPatterns
      .filter(({ pattern }) => pattern.trim().length > 0)
      .filter(
        ({ pattern }) =>
          normalized.startsWith(pattern) || normalized.includes(` ${pattern}`),
      )
      .map(({ score }) => score),
  );

  return directScore + termScore;
}

function directQuestionSubject(question: string) {
  const normalized = question.toLowerCase();
  const whatSubject = normalized.match(/^what\s+(?:is|are)\s+(.+?)\??$/)?.[1];
  const whoSubject = normalized.match(
    /^who\s+(?:is|are)\s+(?:listed\s+as\s+)?(?:the\s+)?(.+?)\??$/,
  )?.[1];

  return normalizeQuestionSubject(whatSubject ?? whoSubject);
}

function normalizeQuestionSubject(subject?: string) {
  return subject?.replace(/^the\s+/, "").trim() ?? null;
}

function normalizeRoleSubject(subject: string) {
  return subject.replace(/^the\s+/, "").replace(/\s+of\s+.+$/, "").trim();
}

function minimumAnswerScore(queryTerms: string[], subject: string | null) {
  if (queryTerms.length === 0) {
    return 0;
  }

  if (subject) {
    return Math.max(2, Math.ceil(queryTerms.length * 0.6));
  }

  return Math.ceil(queryTerms.length * 0.6);
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
