import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

import { buildFallbackAnswer, retrieveContext } from "@/lib/rag";

export const runtime = "nodejs";

const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.1-flash-lite";
const MODEL_TIMEOUT_MS = 12_000;

export async function POST(request: Request) {
  const message = await parseMessage(request);

  if (!message) {
    return Response.json(
      { error: "Message is required." },
      { status: 400 },
    );
  }

  const evidence = retrieveContext(message, 4);
  if (evidence.length === 0) {
    return Response.json({
      answer: buildFallbackAnswer(evidence, message),
      evidence,
      mode: "local-rag-fallback",
    });
  }

  const prompt = buildPrompt(message, evidence);
  const modelAnswer = await callModel(prompt);

  return Response.json({
    answer: modelAnswer.answer ?? buildFallbackAnswer(evidence, message),
    evidence,
    mode: modelAnswer.mode,
  });
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

  return [
    "You are TensorTalk, a UM FSKTM student handbook assistant.",
    "Answer only using the handbook evidence below.",
    "If the evidence is not enough, say you do not have enough handbook evidence.",
    "Keep the answer concise and cite the relevant section or pages when possible.",
    "",
    context,
    "",
    `Question: ${message}`,
  ].join("\n");
}

async function callModel(prompt: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelName = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;

  if (!apiKey) {
    return { answer: null, mode: "local-rag-fallback" };
  }

  try {
    const openrouter = createOpenRouter({ apiKey });
    const { text } = await generateText({
      model: openrouter.chat(modelName),
      prompt,
      maxOutputTokens: 512,
      temperature: 0.2,
      timeout: MODEL_TIMEOUT_MS,
      maxRetries: 1,
    });
    const answer = normalizeModelText(text);

    if (!answer) {
      return { answer: null, mode: "local-rag-fallback" };
    }

    return {
      answer,
      mode: `openrouter:${modelName}`,
    };
  } catch {
    return { answer: null, mode: "model-error" };
  }
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

function normalizeModelText(text: string | null | undefined) {
  const trimmed = text?.trim();

  return trimmed ? trimmed : null;
}
