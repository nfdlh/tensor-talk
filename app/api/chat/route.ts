import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

import {
  parseModelText,
  type ChatResponse,
  type ChatStreamEvent,
} from "@/lib/chat";
import { retrieveContext } from "@/lib/rag";

export const runtime = "nodejs";

const DEFAULT_TENSORTALK_MODEL = "nfdlh/tensortalk-v2";
const MODEL_TIMEOUT_MS = 60_000;

export async function POST(request: Request) {
  const message = await parseMessage(request);

  if (!message) {
    return Response.json(
      { error: "Message is required." },
      { status: 400 },
    );
  }

  try {
    const evidence = retrieveContext(message, 4);
    const prompt = buildPrompt(message, evidence);
    const modelStream = await createFineTunedModelStream(prompt, evidence);

    return modelStream;
  } catch (error) {
    return Response.json(
      {
        error: getPublicModelError(error),
      },
      { status: 502 },
    );
  }
}

function buildPrompt(
  message: string,
  evidence: ReturnType<typeof retrieveContext>,
) {
  const context = evidence
    .map((item, index) => {
      return [
        `Evidence ${index + 1}`,
        `Source: ${item.source_doc ?? "UM Handbook"}`,
        `Scope: ${item.scope_label ?? "unknown"}`,
        `Section: ${item.section ?? "unknown"}`,
        `Subsection: ${item.subsection ?? "unknown"}`,
        `Pages: ${item.pages?.join(", ") ?? "unknown"}`,
        `Text: ${item.source_text ?? ""}`,
      ].join("\n");
    })
    .join("\n\n");

  const promptParts = [
    "You are TensorTalk, a UM FSKTM student handbook assistant.",
    "Answer the student question using your fine-tuned handbook knowledge.",
    "Use the retrieved handbook evidence when it is relevant.",
    "If the evidence is not enough, rely on the fine-tuned TensorTalk model, but avoid inventing exact handbook rules, numbers, or page references.",
    "Keep the answer concise and cite the relevant section or pages when the retrieved evidence provides them.",
    "Do not begin the answer with raw source labels such as Handbook (Section: ..., Pages: ...); the UI displays evidence links separately.",
    "",
    evidence.length > 0
      ? context
      : "No matching handbook evidence was retrieved for this question.",
    "",
    `Question: ${message}`,
  ];

  return promptParts.join("\n");
}

async function createFineTunedModelStream(
  prompt: string,
  evidence: ReturnType<typeof retrieveContext>,
) {
  const baseURL = process.env.TENSORTALK_API_BASE_URL;
  const apiKey =
    process.env.TENSORTALK_API_KEY ??
    process.env.HUGGINGFACE_API_KEY ??
    process.env.HF_TOKEN;
  const modelName = process.env.TENSORTALK_MODEL ?? DEFAULT_TENSORTALK_MODEL;

  if (!baseURL) {
    throw new Error("Missing TENSORTALK_API_BASE_URL.");
  }

  const tensorTalk = createOpenAICompatible({
    name: "tensortalk",
    baseURL,
    apiKey,
  });
  const result = streamText({
    model: tensorTalk(modelName),
    prompt,
    maxOutputTokens: 512,
    temperature: 0.2,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 1,
  });
  const mode = `tensortalk-endpoint:${modelName}`;
  const encoder = new TextEncoder();
  const iterator = result.textStream[Symbol.asyncIterator]();
  const firstChunk = await iterator.next();

  if (firstChunk.done) {
    throw new Error("Fine-tuned model returned an empty answer.");
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let rawText = "";

      function write(event: ChatStreamEvent) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      try {
        write({ type: "metadata", evidence, mode });
        rawText += firstChunk.value;
        write({ type: "text", text: firstChunk.value });

        for (;;) {
          const chunk = await iterator.next();

          if (chunk.done) {
            break;
          }

          rawText += chunk.value;
          write({ type: "text", text: chunk.value });
        }

        const { answer, thinking } = parseModelText(rawText);
        const finalAnswer =
          answer ??
          (thinking ? "The model did not return a final answer." : null);

        if (!finalAnswer) {
          throw new Error("Fine-tuned model returned an empty answer.");
        }

        const response: ChatResponse = {
          answer: finalAnswer,
          evidence,
          mode,
          ...(thinking ? { thinking } : {}),
        };

        write({ type: "done", response });
        controller.close();
      } catch (error) {
        write({ type: "error", error: getPublicModelError(error) });
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

async function parseMessage(request: Request) {
  try {
    const body: unknown = await request.json();

    if (
      !body ||
      typeof body !== "object" ||
      !("message" in body) ||
      typeof body.message !== "string"
    ) {
      return null;
    }

    const message = body.message.trim();

    return message ? message : null;
  } catch {
    return null;
  }
}

function getPublicModelError(error: unknown) {
  if (
    error instanceof Error &&
    error.message === "Missing TENSORTALK_API_BASE_URL."
  ) {
    return "TENSORTALK_API_BASE_URL is required because nfdlh/tensortalk-v2 is uploaded to Hugging Face Hub but still needs an inference endpoint.";
  }

  return "The fine-tuned TensorTalk model could not be reached.";
}
