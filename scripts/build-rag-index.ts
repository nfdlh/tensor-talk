import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type HandbookIndexRow = {
  id: number;
  kb_id: string;
  title?: string;
  scope_label?: string;
  source_doc?: string;
  section?: string;
  subsection?: string;
  retrieval_text?: string;
  source_text?: string;
  retrieval_keywords?: string[];
  group_canonical_questions?: string[];
  chunk_question_variants?: string[];
};

type OpenRouterEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
};

const PROJECT_ROOT = process.cwd();
const KB_PATH = path.join(PROJECT_ROOT, "data", "UM_RAG_Knowledge_Base.jsonl");
const DB_PATH = path.join(PROJECT_ROOT, "data", "UM_RAG_Vectors.sqlite");
const TMP_DB_PATH = `${DB_PATH}.tmp`;

loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
loadEnvFile(path.join(PROJECT_ROOT, ".env"));

const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL ?? "baai/bge-base-en-v1.5";
const BATCH_SIZE = Number(process.env.RAG_INDEX_BATCH_SIZE ?? 96);
const MAX_EMBEDDING_TEXT_CHARS = process.env.RAG_INDEX_MAX_TEXT_CHARS
  ? Number(process.env.RAG_INDEX_MAX_TEXT_CHARS)
  : undefined;

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  throw new Error("Missing OPENROUTER_API_KEY. Add it to .env.local first.");
}

const rows = fs
  .readFileSync(KB_PATH, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line, index): HandbookIndexRow => ({
    ...(JSON.parse(line) as Omit<HandbookIndexRow, "id">),
    id: index,
  }));

if (rows.length === 0) {
  throw new Error(`No rows found in ${KB_PATH}.`);
}

fs.rmSync(TMP_DB_PATH, { force: true });

const db = new DatabaseSync(TMP_DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE rag_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE rag_vectors (
    id INTEGER PRIMARY KEY,
    kb_id TEXT NOT NULL UNIQUE,
    row_json TEXT NOT NULL,
    retrieval_text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    dimension INTEGER NOT NULL
  );

  CREATE INDEX idx_rag_vectors_kb_id ON rag_vectors(kb_id);
`);

const insertMeta = db.prepare(
  "INSERT INTO rag_meta (key, value) VALUES (?, ?)",
);
insertMeta.run("embedding_model", EMBEDDING_MODEL);
insertMeta.run("source_file", path.relative(PROJECT_ROOT, KB_PATH));
insertMeta.run("row_count", String(rows.length));
insertMeta.run("built_at", new Date().toISOString());

const insertVector = db.prepare(`
  INSERT INTO rag_vectors (
    id,
    kb_id,
    row_json,
    retrieval_text,
    embedding,
    dimension
  )
  VALUES (?, ?, ?, ?, ?, ?)
`);
for (let start = 0; start < rows.length; start += BATCH_SIZE) {
  const batchRows = rows.slice(start, start + BATCH_SIZE);
  const texts = batchRows.map(getRetrievalText);
  const embeddings = await createEmbeddings(texts);

  db.exec("BEGIN");
  try {
    batchRows.forEach((row, index) => {
      const embedding = embeddings[index];
      insertVector.run(
        row.id,
        row.kb_id,
        JSON.stringify(row),
        getRetrievalText(row),
        vectorToBuffer(embedding),
        embedding.length,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  console.log(
    `Indexed ${Math.min(start + batchRows.length, rows.length)} / ${rows.length}`,
  );
}

db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
db.exec("PRAGMA journal_mode = DELETE");
db.close();
fs.renameSync(TMP_DB_PATH, DB_PATH);

console.log(`Wrote ${path.relative(PROJECT_ROOT, DB_PATH)}`);

function getRetrievalText(row: HandbookIndexRow) {
  const text = row.retrieval_text || row.source_text || "";

  return MAX_EMBEDDING_TEXT_CHARS && text.length > MAX_EMBEDDING_TEXT_CHARS
    ? text.slice(0, MAX_EMBEDDING_TEXT_CHARS)
    : text;
}

async function createEmbeddings(input: string[], singleRetry = 0): Promise<number[][]> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      encoding_format: "float",
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | OpenRouterEmbeddingResponse
    | null;

  if (!response.ok) {
    throw new Error(
      body?.error?.message ??
        `OpenRouter embeddings request failed with ${response.status}.`,
    );
  }

  const embeddings = body?.data?.map((item) => item.embedding ?? []) ?? [];

  if (embeddings.length !== input.length && input.length > 1) {
    const midpoint = Math.ceil(input.length / 2);
    const left = await createEmbeddings(input.slice(0, midpoint));
    const right = await createEmbeddings(input.slice(midpoint));

    return [...left, ...right];
  }

  if (
    input.length === 1 &&
    (embeddings.length !== input.length || embeddings[0]?.length === 0) &&
    singleRetry < 4 &&
    input[0].length > 256
  ) {
    const nextLength = Math.max(256, Math.floor(input[0].length / 2));

    return createEmbeddings([input[0].slice(0, nextLength)], singleRetry + 1);
  }

  if (
    embeddings.length !== input.length ||
    embeddings.some((embedding) => embedding.length === 0)
  ) {
    throw new Error("OpenRouter returned an invalid embedding batch.");
  }

  return embeddings.map(normalizeVector);
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );

  if (!magnitude) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function vectorToBuffer(vector: number[]) {
  return Buffer.from(Float32Array.from(vector).buffer);
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
