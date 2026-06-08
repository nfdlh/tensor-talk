import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { getOpenRouterApiKey, getOpenRouterBaseUrl } from "@/lib/openrouter";

export const runtime = "nodejs";

const DEFAULT_THREAD_TITLE_MODEL = "google/gemini-3.1-flash-lite";
const TITLE_TIMEOUT_MS = 20_000;

export async function POST(request: Request) {
  const payload = await parseRequest(request);

  if (!payload) {
    return Response.json({ error: "Question is required." }, { status: 400 });
  }

  const fallback = fallbackTitle(payload.question);
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    return Response.json({ title: fallback, mode: "fallback" });
  }

  try {
    const openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: getOpenRouterBaseUrl(),
      apiKey,
    });
    const prompt = payload.answer
      ? [
          "Create a short chat title from this question and answer.",
          "Use 3 to 6 words. Return plain text only.",
          "",
          `Question: ${payload.question}`,
          `Answer: ${payload.answer.slice(0, 600)}`,
        ].join("\n")
      : [
          "Create a short chat title from this question.",
          "Use 3 to 6 words. Return plain text only.",
          "",
          `Question: ${payload.question}`,
        ].join("\n");

    const { text } = await generateText({
      model: openrouter(
        process.env.THREAD_TITLE_MODEL ?? DEFAULT_THREAD_TITLE_MODEL,
      ),
      prompt,
      maxOutputTokens: 24,
      temperature: 0.2,
      timeout: TITLE_TIMEOUT_MS,
      maxRetries: 0,
    });
    const title = sanitizeTitle(text) || fallback;

    return Response.json({ title, mode: "openrouter" });
  } catch {
    return Response.json({ title: fallback, mode: "fallback" });
  }
}

async function parseRequest(request: Request) {
  try {
    const body = (await request.json()) as {
      question?: unknown;
      answer?: unknown;
    };
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";

    return question ? { question, answer } : null;
  } catch {
    return null;
  }
}

function fallbackTitle(question: string) {
  return sanitizeTitle(question).slice(0, 52) || "New chat";
}

function sanitizeTitle(title: string) {
  return title
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
