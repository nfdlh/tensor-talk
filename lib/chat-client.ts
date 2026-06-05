import ky from "ky";

import type { ChatRequest, ChatResponse } from "@/lib/chat";

export function sendChatMessage(payload: ChatRequest) {
  return ky.post("/api/chat", { json: payload }).json<ChatResponse>();
}
