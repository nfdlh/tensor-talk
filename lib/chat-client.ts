import {
  parseModelText,
  type ChatStage,
  type ChatRequest,
  type ChatResponse,
  type ChatStreamEvent,
} from "@/lib/chat";

export async function sendChatMessage(
  payload: ChatRequest,
  onUpdate?: (partial: Partial<ChatResponse>) => void,
  onStage?: (stage: ChatStage) => void,
  options: { signal?: AbortSignal } = {},
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new Error(body?.error ?? "Chat request failed.");
  }

  if (!response.body) {
    throw new Error("Chat response stream was empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let finalResponse: ChatResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line) as ChatStreamEvent;

      if (event.type === "stage") {
        onStage?.(event.stage);
        continue;
      }

      if (event.type === "metadata") {
        onUpdate?.({
          evidence: event.evidence,
          mode: event.mode,
          models: event.models,
          retrievalMode: event.retrievalMode,
          webMode: event.webMode,
          harnessMode: event.harnessMode,
          thinkingMode: event.thinkingMode,
          trace: event.trace,
          grounding: event.grounding,
          context: event.context,
        });
        continue;
      }

      if (event.type === "text") {
        rawText += event.text;
        const { answer, thinking } = parseModelText(rawText);
        onUpdate?.({
          answer: answer ?? "",
          ...(thinking ? { thinking } : {}),
        });
        continue;
      }

      if (event.type === "done") {
        finalResponse = event.response;
        onUpdate?.(event.response);
        continue;
      }

      throw new Error(event.error);
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error("Chat response stream ended before completion.");
  }

  return finalResponse;
}
