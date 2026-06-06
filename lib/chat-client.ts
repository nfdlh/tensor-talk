import ky, { HTTPError } from "ky";

import type { ChatRequest, ChatResponse } from "@/lib/chat";

export async function sendChatMessage(payload: ChatRequest) {
  try {
    return await ky.post("/api/chat", { json: payload }).json<ChatResponse>();
  } catch (error) {
    if (error instanceof HTTPError) {
      const body = await error.response
        .json<{ error?: string }>()
        .catch(() => null);

      throw new Error(body?.error ?? "Chat request failed.");
    }

    throw error;
  }
}
