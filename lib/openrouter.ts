const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const EMBEDDING_TIMEOUT_MS = 30_000;

export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = "baai/bge-base-en-v1.5";
export const DEFAULT_OPENROUTER_EXPERIMENTAL_EMBEDDING_MODEL =
  "qwen/qwen3-embedding-8b";
export const DEFAULT_OPENROUTER_HARNESS_MODEL = "qwen/qwen3-8b";
export const DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL =
  "openai/gpt-4o-mini-transcribe";
export const QWEN3_RETRIEVAL_QUERY_INSTRUCTION =
  "Given a student handbook question, retrieve relevant Universiti Malaya Faculty of Computer Science and Information Technology handbook passages that answer the question.";

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

export function getOpenRouterEmbeddingModel(retrievalMode = "semantic") {
  if (retrievalMode === "semantic-qwen") {
    return (
      process.env.OPENROUTER_EXPERIMENTAL_EMBEDDING_MODEL ??
      DEFAULT_OPENROUTER_EXPERIMENTAL_EMBEDDING_MODEL
    );
  }

  return (
    process.env.OPENROUTER_EMBEDDING_MODEL ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL
  );
}

export function getOpenRouterHarnessModel() {
  return (
    process.env.OPENROUTER_HARNESS_MODEL ?? DEFAULT_OPENROUTER_HARNESS_MODEL
  );
}

export function getOpenRouterTranscriptionModel() {
  return (
    process.env.OPENROUTER_TRANSCRIPTION_MODEL ??
    DEFAULT_OPENROUTER_TRANSCRIPTION_MODEL
  );
}

export function getOpenRouterBaseUrl() {
  return process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL;
}

type EmbeddingInputType = "query" | "document";

export async function createOpenRouterEmbeddings(
  input: string | string[],
  options: {
    inputType?: EmbeddingInputType;
    retrievalMode?: string;
  } = {},
) {
  const apiKey = getOpenRouterApiKey();
  const model = getOpenRouterEmbeddingModel(options.retrievalMode);
  const formattedInput = formatEmbeddingInput(
    input,
    options.retrievalMode,
    options.inputType,
  );

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
      model,
      input: formattedInput,
      encoding_format: "float",
    }),
    signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("OpenRouter embeddings request timed out.");
    }

    throw error;
  });
  const body = (await response
    .json()
    .catch(() => null)) as OpenRouterEmbeddingResponse | null;

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

function formatEmbeddingInput(
  input: string | string[],
  retrievalMode?: string,
  inputType: EmbeddingInputType = "document",
) {
  if (retrievalMode !== "semantic-qwen" || inputType !== "query") {
    return input;
  }

  const formatQuery = (query: string) =>
    `Instruct: ${QWEN3_RETRIEVAL_QUERY_INSTRUCTION}\nQuery:${query}`;

  return Array.isArray(input) ? input.map(formatQuery) : formatQuery(input);
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
