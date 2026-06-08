import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import MiniSearch from "minisearch";

import type { RetrievalMode } from "@/lib/chat";
import {
  createOpenRouterEmbeddings,
  getOpenRouterEmbeddingModel,
} from "@/lib/openrouter";

export type HandbookEvidence = {
  kb_id: string;
  sourceType?: "handbook";
  source_doc?: string;
  scope_label?: string;
  section?: string;
  subsection?: string;
  pages?: number[];
  source_text?: string;
  grounded_answer_bank?: string[];
  rank?: number;
  confidence?: number;
  supportScore?: number;
  supportBand?: "strong" | "moderate" | "weak";
};

type HandbookRow = HandbookEvidence & {
  id: number;
  title?: string;
  retrieval_text?: string;
  retrieval_keywords?: string[];
  retrieval_tags?: string[];
  group_canonical_questions?: string[];
  chunk_question_variants?: string[];
};

type VectorRecord = {
  id: number;
  row_json: string;
  embedding: Uint8Array;
  dimension: number;
};

type VectorIndex = {
  records: VectorRecord[];
  embeddingModel?: string;
  dimension: number;
};

type SemanticHit = {
  row: HandbookRow;
  denseScore: number;
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
const TOP_K_RERANK_POOL = 12;
const DENSE_SCORE_WEIGHT = 0.82;
const SCOPE_BONUS_WEIGHT = 0.06;
const SECTION_BONUS_WEIGHT = 0.04;
const SUBSECTION_BONUS_WEIGHT = 0.03;
const SOURCE_DOC_BONUS_WEIGHT = 0.02;
const KEYWORD_BONUS_WEIGHT = 0.03;
const LEXICAL_STRONG_SCORE = 80;

let rowsCache: HandbookRow[] | null = null;
let searchCache: MiniSearch<HandbookRow> | null = null;
const VECTOR_INDEX_FILES: Record<
  Extract<RetrievalMode, "semantic" | "semantic-qwen">,
  string
> = {
  semantic: "UM_RAG_Vectors.sqlite",
  "semantic-qwen": "UM_RAG_Vectors_Qwen3.sqlite",
};

const vectorCache: Partial<Record<RetrievalMode, VectorIndex>> = {};

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

export async function retrieveContext(
  question: string,
  topK = 4,
  mode: RetrievalMode = "lexical",
): Promise<HandbookEvidence[]> {
  if (mode === "none") {
    return [];
  }

  if (isSemanticMode(mode)) {
    return retrieveSemanticContext(question, topK, mode);
  }

  return retrieveLexicalContext(question, topK);
}

function retrieveLexicalContext(
  question: string,
  topK = 4,
): HandbookEvidence[] {
  const { rows, search } = loadKnowledgeBase();
  const query = question.trim();

  if (!query) {
    return [];
  }

  const queryTerms = meaningfulTerms(query);
  const subject = directQuestionSubject(query);
  const searchQuery = queryTerms.length > 0 ? queryTerms.join(" ") : query;
  const scoredMatches = search
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
      score: contextScore(
        match.row,
        query,
        queryTerms,
        subject,
        match.searchScore,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
  return scoredMatches.map((match, index) =>
    toEvidence(match.row, index + 1, lexicalConfidence(match.score), question),
  );
}

async function retrieveSemanticContext(
  question: string,
  topK = 4,
  mode: Extract<RetrievalMode, "semantic" | "semantic-qwen"> = "semantic",
) {
  const query = question.trim();

  if (!query) {
    return [];
  }

  const index = loadVectorIndex(mode);
  const [queryVector] = await createOpenRouterEmbeddings(query, {
    inputType: "query",
    retrievalMode: mode,
  });
  validateVectorIndex(index, queryVector.length, mode);
  const rerankPool = Math.max(topK, TOP_K_RERANK_POOL);
  const queryMeta = inferExpectedMetadata(query);
  const denseHits = index.records
    .map((record) => {
      const embedding = bufferToVector(record.embedding, record.dimension);

      return {
        row: JSON.parse(record.row_json) as HandbookRow,
        denseScore: dotProduct(queryVector, embedding),
      };
    })
    .sort((left, right) => right.denseScore - left.denseScore)
    .slice(0, rerankPool);

  const scoredHits = denseHits
    .map((hit) => ({
      hit,
      score: semanticScore(hit, question, queryMeta),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  return scoredHits.map((item, index) =>
    toEvidence(
      item.hit.row,
      index + 1,
      semanticConfidence(item.score),
      question,
    ),
  );
}

function loadVectorIndex(
  mode: Extract<RetrievalMode, "semantic" | "semantic-qwen">,
) {
  if (vectorCache[mode]) {
    return vectorCache[mode];
  }

  const indexFile = VECTOR_INDEX_FILES[mode];
  const filePath = path.join(process.cwd(), "data", indexFile);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing data/${indexFile}. Run \`pnpm rag:index\` first.`);
  }

  const dbUrl = pathToFileURL(filePath);
  dbUrl.searchParams.set("immutable", "1");
  const db = new DatabaseSync(dbUrl.href, { readOnly: true });
  const records = db
    .prepare(
      "SELECT id, row_json, embedding, dimension FROM rag_vectors ORDER BY id",
    )
    .all() as VectorRecord[];
  const metaRows = db
    .prepare("SELECT key, value FROM rag_meta")
    .all() as Array<{ key: string; value: string }>;

  db.close();

  if (records.length === 0) {
    throw new Error("The SQLite vector index is empty.");
  }

  const dimension = records[0].dimension;

  if (records.some((record) => record.dimension !== dimension)) {
    throw new Error("Semantic vector index contains mixed dimensions.");
  }

  const meta = Object.fromEntries(
    metaRows.map((row) => [row.key, row.value]),
  ) as Record<string, string | undefined>;

  vectorCache[mode] = {
    records,
    embeddingModel: meta.embedding_model,
    dimension,
  };

  return vectorCache[mode];
}

function validateVectorIndex(
  index: VectorIndex,
  queryDimension: number,
  mode: Extract<RetrievalMode, "semantic" | "semantic-qwen">,
) {
  const runtimeModel = getOpenRouterEmbeddingModel(mode);

  if (index.embeddingModel && index.embeddingModel !== runtimeModel) {
    throw new Error(
      `Semantic vector index was built with ${index.embeddingModel}, but OPENROUTER_EMBEDDING_MODEL is ${runtimeModel}. Run \`pnpm rag:index\` again.`,
    );
  }

  if (index.dimension !== queryDimension) {
    throw new Error(
      `Semantic vector index dimension ${index.dimension} does not match query embedding dimension ${queryDimension}. Run \`pnpm rag:index\` again.`,
    );
  }
}

function isSemanticMode(
  mode: RetrievalMode,
): mode is Extract<RetrievalMode, "semantic" | "semantic-qwen"> {
  return mode === "semantic" || mode === "semantic-qwen";
}

function semanticScore(
  hit: SemanticHit,
  question: string,
  queryMeta: Partial<HandbookRow>,
) {
  const { row, denseScore } = hit;
  const scopeBonus = metadataBonus(queryMeta.scope_label, row.scope_label);
  const sectionBonus = metadataBonus(queryMeta.section, row.section);
  const subsectionBonus = metadataBonus(queryMeta.subsection, row.subsection);
  const sourceDocBonus = metadataBonus(queryMeta.source_doc, row.source_doc);
  const keywordBonus = keywordBonusScore(question, row);
  let finalScore =
    DENSE_SCORE_WEIGHT * denseScore +
    SCOPE_BONUS_WEIGHT * scopeBonus +
    SECTION_BONUS_WEIGHT * sectionBonus +
    SUBSECTION_BONUS_WEIGHT * subsectionBonus +
    SOURCE_DOC_BONUS_WEIGHT * sourceDocBonus +
    KEYWORD_BONUS_WEIGHT * keywordBonus;

  if (queryMeta.scope_label && row.scope_label) {
    if (queryMeta.scope_label !== row.scope_label) {
      finalScore *= 0.92;
    }
  }

  return finalScore;
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

function toEvidence(
  row: HandbookRow,
  rank: number,
  confidence: number,
  question: string,
): HandbookEvidence {
  const supportScore = supportScoreFromConfidence(
    confidence,
    overlapScore(question, row.source_text ?? ""),
  );

  return {
    kb_id: row.kb_id,
    sourceType: "handbook",
    source_doc: row.source_doc,
    scope_label: row.scope_label,
    section: row.section,
    subsection: row.subsection,
    pages: row.pages,
    source_text: row.source_text,
    grounded_answer_bank: row.grounded_answer_bank,
    rank,
    confidence,
    supportScore,
    supportBand: supportBand(supportScore),
  };
}

export function lexicalConfidence(score: number) {
  return clamp(score / LEXICAL_STRONG_SCORE);
}

function semanticConfidence(score: number) {
  return clamp((score + 1) / 2);
}

function supportScoreFromConfidence(
  confidence: number,
  questionOverlap: number,
) {
  return clamp(0.75 * confidence + 0.25 * questionOverlap);
}

function supportBand(score: number): "strong" | "moderate" | "weak" {
  if (score >= 0.72) {
    return "strong";
  }

  if (score >= 0.52) {
    return "moderate";
  }

  return "weak";
}

function overlapScore(left: string, right: string) {
  const leftTerms = meaningfulTerms(left);

  if (leftTerms.length === 0) {
    return 0;
  }

  const rightTerms = new Set(meaningfulTerms(right));
  const hits = leftTerms.filter((term) => rightTerms.has(term)).length;

  return clamp(hits / leftTerms.length);
}

function clamp(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function answerScore(
  answer: string,
  queryTerms: string[],
  subject: string | null,
) {
  const normalized = answer.toLowerCase();
  const termScore = queryTerms.filter((term) =>
    normalized.includes(term),
  ).length;

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

function inferExpectedMetadata(question: string): Partial<HandbookRow> {
  const normalized = question.toLowerCase();

  if (
    /\b(postgraduate|master|phd|doctoral|doctor of philosophy|candidature|thesis|dissertation)\b/.test(
      normalized,
    )
  ) {
    return {
      scope_label: "postgraduate",
      source_doc: "Complete Handbook",
    };
  }

  if (
    /\b(undergraduate|bachelor|industrial training|academic project|degree programme)\b/.test(
      normalized,
    )
  ) {
    return {
      scope_label: "undergraduate",
      source_doc: "Complete Handbook",
    };
  }

  return {
    scope_label: "general",
  };
}

function keywordBonusScore(question: string, row: HandbookRow) {
  const queryTokens = new Set(normalizeForMatch(question).split(" "));
  const keywordTokens = new Set(
    (row.retrieval_keywords ?? [])
      .flatMap((keyword) => normalizeForMatch(keyword).split(" "))
      .filter(Boolean),
  );
  let overlap = 0;

  for (const token of queryTokens) {
    if (keywordTokens.has(token)) {
      overlap += 1;
    }
  }

  return Math.min(overlap / 8, 1);
}

function metadataBonus(expectedValue?: string, rowValue?: string) {
  if (!expectedValue || !rowValue) {
    return 0;
  }

  return normalizeForMatch(expectedValue) === normalizeForMatch(rowValue)
    ? 1
    : 0;
}

function bufferToVector(buffer: Uint8Array, dimension: number) {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const vector = new Array<number>(dimension);

  for (let index = 0; index < dimension; index += 1) {
    vector[index] = view.getFloat32(index * 4, true);
  }

  return vector;
}

function dotProduct(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let score = 0;

  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }

  return score;
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
  return subject
    .replace(/^the\s+/, "")
    .replace(/\s+of\s+.+$/, "")
    .trim();
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
