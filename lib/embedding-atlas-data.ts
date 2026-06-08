import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createUMAP } from "embedding-atlas";

type VectorRecord = {
  id: number;
  kb_id: string;
  row_json: string;
  embedding: Uint8Array;
  dimension: number;
};

type HandbookRow = {
  kb_id: string;
  title?: string;
  scope_label?: string;
  source_doc?: string;
  section?: string;
  subsection?: string;
  retrieval_text?: string;
  source_text?: string;
};

export type EmbeddingAtlasPoint = {
  id: number;
  kb_id: string;
  title: string;
  scopeLabel: string;
  sourceDoc: string;
  section: string;
  subsection: string;
  text: string;
  x: number;
  y: number;
  category: number;
};

export type EmbeddingAtlasPayload = {
  meta: {
    pointCount: number;
    dimension: number;
    embeddingModel: string;
    sourceFile: string;
    builtAt: string;
    projection: string;
  };
  categories: Array<{
    name: string;
    count: number;
    color: string;
  }>;
  labels: Array<{
    x: number;
    y: number;
    content: string;
    level: number;
    priority: number;
  }>;
  points: EmbeddingAtlasPoint[];
};

const VECTOR_DB_PATH = path.join(process.cwd(), "data", "UM_RAG_Vectors.sqlite");
const CATEGORY_COLORS = [
  "#2563eb",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
];

let cachedPayload: Promise<EmbeddingAtlasPayload> | null = null;

export function getEmbeddingAtlasPayload() {
  cachedPayload ??= buildEmbeddingAtlasPayload();

  return cachedPayload;
}

async function buildEmbeddingAtlasPayload(): Promise<EmbeddingAtlasPayload> {
  if (!fs.existsSync(VECTOR_DB_PATH)) {
    throw new Error(
      "Missing data/UM_RAG_Vectors.sqlite. Run `pnpm rag:index` first.",
    );
  }

  const db = new DatabaseSync(VECTOR_DB_PATH, { readOnly: true });

  try {
    const records = db
      .prepare(
        "SELECT id, kb_id, row_json, embedding, dimension FROM rag_vectors ORDER BY id",
      )
      .all() as VectorRecord[];
    const metaRows = db
      .prepare("SELECT key, value FROM rag_meta")
      .all() as Array<{ key: string; value: string }>;

    if (records.length === 0) {
      throw new Error("The SQLite vector index is empty.");
    }

    const dimension = records[0].dimension;

    if (records.some((record) => record.dimension !== dimension)) {
      throw new Error("Semantic vector index contains mixed dimensions.");
    }

    const vectors = new Float32Array(records.length * dimension);

    records.forEach((record, recordIndex) => {
      const view = new DataView(
        record.embedding.buffer,
        record.embedding.byteOffset,
        record.embedding.byteLength,
      );

      for (let index = 0; index < dimension; index += 1) {
        vectors[recordIndex * dimension + index] = view.getFloat32(
          index * 4,
          true,
        );
      }
    });

    const umap = await createUMAP(records.length, dimension, 2, vectors, {
      metric: "cosine",
      nNeighbors: Math.min(18, records.length - 1),
      minDist: 0.06,
      spread: 1,
      seed: 42,
    });

    try {
      await umap.run();

      const projection = umap.embedding;
      const meta = Object.fromEntries(
        metaRows.map((row) => [row.key, row.value]),
      );
      const rows = records.map(
        (record) => JSON.parse(record.row_json) as HandbookRow,
      );
      const categoryNames = Array.from(
        new Set(rows.map((row) => normalizeCategory(row.scope_label))),
      ).sort();
      const categoryCounts = new Map(categoryNames.map((name) => [name, 0]));
      const points = records.map((record, index): EmbeddingAtlasPoint => {
        const row = rows[index];
        const scopeLabel = normalizeCategory(row.scope_label);
        const category = categoryNames.indexOf(scopeLabel);

        categoryCounts.set(
          scopeLabel,
          (categoryCounts.get(scopeLabel) ?? 0) + 1,
        );

        return {
          id: record.id,
          kb_id: record.kb_id,
          title: row.title ?? "Untitled handbook chunk",
          scopeLabel,
          sourceDoc: row.source_doc ?? "Unknown source",
          section: row.section ?? "Unsectioned",
          subsection: row.subsection ?? "",
          text: summarizeText(row.source_text ?? row.retrieval_text ?? ""),
          x: projection[index * 2],
          y: projection[index * 2 + 1],
          category,
        };
      });

      return {
        meta: {
          pointCount: records.length,
          dimension,
          embeddingModel: meta.embedding_model ?? "unknown",
          sourceFile: meta.source_file ?? "data/UM_RAG_Knowledge_Base.jsonl",
          builtAt: meta.built_at ?? "unknown",
          projection: "Embedding Atlas UMAP, cosine metric",
        },
        categories: categoryNames.map((name, index) => ({
          name,
          count: categoryCounts.get(name) ?? 0,
          color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
        })),
        labels: createSectionLabels(points),
        points,
      };
    } finally {
      umap.destroy();
    }
  } finally {
    db.close();
  }
}

function normalizeCategory(value?: string) {
  return value?.trim() || "uncategorized";
}

function summarizeText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 520);
}

function createSectionLabels(points: EmbeddingAtlasPoint[]) {
  const groups = new Map<
    string,
    { count: number; x: number; y: number; priority: number }
  >();

  for (const point of points) {
    const label = point.section || point.scopeLabel;
    const current = groups.get(label) ?? {
      count: 0,
      x: 0,
      y: 0,
      priority: 0,
    };

    current.count += 1;
    current.x += point.x;
    current.y += point.y;
    current.priority = Math.max(current.priority, point.text.length);
    groups.set(label, current);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.count >= 4)
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 18)
    .map(([text, group], index) => ({
      x: group.x / group.count,
      y: group.y / group.count,
      content: text,
      level: index < 8 ? 0 : 1,
      priority: group.count * (index < 8 ? 2 : 1),
    }));
}
