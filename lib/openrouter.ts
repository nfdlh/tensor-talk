const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const EMBEDDING_TIMEOUT_MS = 30_000;

export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = "baai/bge-base-en-v1.5";
export const DEFAULT_OPENROUTER_HARNESS_MODEL = "qwen/qwen3-8b";

type OpenRouterEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
};

export function getOpenRouterApiKey() {
  return process.env.OPENROUTER_API_KEY;
}

export function getOpenRouterEmbeddingModel() {
  return (
    process.env.OPENROUTER_EMBEDDING_MODEL ??
    DEFAULT_OPENROUTER_EMBEDDING_MODEL
  );
}

export function getOpenRouterHarnessModel() {
  return process.env.OPENROUTER_HARNESS_MODEL ?? DEFAULT_OPENROUTER_HARNESS_MODEL;
}

export function getOpenRouterBaseUrl() {
  return process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL;
}

export async function createOpenRouterEmbeddings(input: string | string[]) {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY.");
  }

  const response = await fetch(`${getOpenRouterBaseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenRouterEmbeddingModel(),
      input,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("OpenRouter embeddings request timed out.");
    }

    throw error;
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

  if (embeddings.length === 0 || embeddings.some((item) => item.length === 0)) {
    throw new Error("OpenRouter returned an empty embedding.");
  }

  return embeddings.map(normalizeVector);
}

export function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );

  if (!magnitude) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}
