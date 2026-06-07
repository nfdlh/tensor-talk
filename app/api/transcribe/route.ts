import { NextRequest, NextResponse } from "next/server";

import {
  getOpenRouterApiKey,
  getOpenRouterBaseUrl,
  getOpenRouterTranscriptionModel,
} from "@/lib/openrouter";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const SUPPORTED_FORMATS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "wav",
  "webm",
]);

type OpenRouterTranscriptionResponse = {
  text?: string;
  usage?: unknown;
  error?: {
    message?: string;
  };
};

export async function POST(request: NextRequest) {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is required for speech-to-text." },
      { status: 503 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const audio = formData?.get("audio");

  if (!(audio instanceof File)) {
    return NextResponse.json(
      { error: "Audio file is required." },
      { status: 400 },
    );
  }

  if (audio.size === 0) {
    return NextResponse.json(
      { error: "Audio file is empty." },
      { status: 400 },
    );
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Audio file is too large." },
      { status: 413 },
    );
  }

  const format = getAudioFormat(audio.type, audio.name);

  if (!format) {
    return NextResponse.json(
      { error: "Unsupported audio format." },
      { status: 415 },
    );
  }

  const audioBuffer = Buffer.from(await audio.arrayBuffer());
  const model = getOpenRouterTranscriptionModel();
  // OpenRouter STT expects base64 JSON at /audio/transcriptions. Multipart
  // uploads are rejected by this endpoint even though OpenAI accepts them.
  const response = await fetch(
    `${getOpenRouterBaseUrl()}/audio/transcriptions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          request.headers.get("origin") ?? "http://localhost:3000",
        "X-Title": "TensorTalk",
      },
      body: JSON.stringify({
        model,
        input_audio: {
          data: audioBuffer.toString("base64"),
          format,
        },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    },
  ).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("OpenRouter transcription request timed out.");
    }

    throw error;
  });
  const body = (await response
    .json()
    .catch(() => null)) as OpenRouterTranscriptionResponse | null;

  if (!response.ok) {
    return NextResponse.json(
      {
        error:
          body?.error?.message ??
          `OpenRouter transcription request failed with ${response.status}.`,
      },
      { status: response.status },
    );
  }

  const text = body?.text?.trim() ?? "";

  if (!text) {
    return NextResponse.json(
      { error: "OpenRouter returned an empty transcription." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    text,
    model,
    usage: body?.usage,
  });
}

function getAudioFormat(mimeType: string, fileName: string) {
  const cleanMime = mimeType.split(";")[0]?.toLowerCase();
  const mimeFormat =
    cleanMime === "audio/mpeg"
      ? "mp3"
      : cleanMime === "audio/mp4"
        ? "m4a"
        : cleanMime?.replace("audio/", "");
  const extension = fileName.split(".").pop()?.toLowerCase();
  const format =
    mimeFormat && SUPPORTED_FORMATS.has(mimeFormat) ? mimeFormat : extension;

  return format && SUPPORTED_FORMATS.has(format) ? format : null;
}
