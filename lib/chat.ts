export type Evidence = {
  kb_id: string;
  source_doc?: string;
  scope_label?: string;
  section?: string;
  subsection?: string;
  pages?: number[];
  source_text?: string;
};

export type ChatRequest = {
  message: string;
};

export type ChatResponse = {
  answer: string;
  evidence: Evidence[];
  mode: string;
  thinking?: string;
};

export type ChatStreamEvent =
  | {
      type: "metadata";
      evidence: Evidence[];
      mode: string;
    }
  | {
      type: "text";
      text: string;
    }
  | {
      type: "done";
      response: ChatResponse;
    }
  | {
      type: "error";
      error: string;
    };

export function parseModelText(text: string | null | undefined) {
  const rawText = text ?? "";
  const thinkingParts = Array.from(
    rawText.matchAll(/<think>([\s\S]*?)(?:<\/think>|$)/gi),
    (match) => match[1].trim(),
  ).filter(Boolean);
  const withoutThinking = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "");
  const answer = withoutThinking.trim();
  const thinking = thinkingParts.join("\n\n").trim();

  return {
    answer: answer ? answer : null,
    thinking: thinking ? thinking : null,
  };
}
