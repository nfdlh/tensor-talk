import type { ChatContextMetadata, ChatHistoryTurn } from "@/lib/chat";

export const MAX_CONTEXT_TOKENS = 4096;
export const RESERVED_OUTPUT_TOKENS = 768;
export const INPUT_TOKEN_BUDGET = MAX_CONTEXT_TOKENS - RESERVED_OUTPUT_TOKENS;
export const EMPTY_HISTORY_BLOCK = "";

const MAX_HISTORY_QUESTION_CHARS = 280;
const MAX_HISTORY_ANSWER_CHARS = 700;
const HISTORY_SEPARATOR_TOKENS = estimateTokens("\n\n");

type HistoryContext = {
  block: string;
  includedHistoryCount: number;
  omittedHistoryCount: number;
  contextTruncated: boolean;
};

export function buildHistoryContext(
  history: ChatHistoryTurn[],
  availableTokens: number,
): HistoryContext {
  const usableHistory = history
    .map(compactHistoryTurn)
    .filter((turn) => turn.question && turn.answer);
  const included: ChatHistoryTurn[] = [];
  let remainingTokens = Math.max(0, availableTokens);

  for (let index = usableHistory.length - 1; index >= 0; index -= 1) {
    const turn = usableHistory[index];
    const block = formatHistoryTurn(turn);
    const tokens =
      estimateTokens(block) +
      (included.length > 0 ? HISTORY_SEPARATOR_TOKENS : 0);

    if (tokens > remainingTokens) {
      break;
    }

    included.unshift(turn);
    remainingTokens -= tokens;
  }

  return {
    block:
      included.length > 0
        ? included.map(formatHistoryTurn).join("\n\n")
        : EMPTY_HISTORY_BLOCK,
    includedHistoryCount: included.length,
    omittedHistoryCount: usableHistory.length - included.length,
    contextTruncated: included.length < usableHistory.length,
  };
}

export function createContextMetadata(
  estimatedInputTokens: number,
  historyContext: Pick<
    HistoryContext,
    "includedHistoryCount" | "omittedHistoryCount" | "contextTruncated"
  >,
): ChatContextMetadata {
  return {
    maxContextTokens: MAX_CONTEXT_TOKENS,
    reservedOutputTokens: RESERVED_OUTPUT_TOKENS,
    estimatedInputTokens,
    estimatedContextUsagePercent: Math.min(
      100,
      Math.round(
        ((estimatedInputTokens + RESERVED_OUTPUT_TOKENS) /
          MAX_CONTEXT_TOKENS) *
          100,
      ),
    ),
    includedHistoryCount: historyContext.includedHistoryCount,
    omittedHistoryCount: historyContext.omittedHistoryCount,
    contextTruncated: historyContext.contextTruncated,
  };
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function compactHistoryTurn(turn: ChatHistoryTurn): ChatHistoryTurn {
  return {
    question: compactText(turn.question, MAX_HISTORY_QUESTION_CHARS),
    answer: compactText(stripThinking(turn.answer), MAX_HISTORY_ANSWER_CHARS),
  };
}

function formatHistoryTurn(turn: ChatHistoryTurn) {
  return [`Previous question: ${turn.question}`, `Previous answer: ${turn.answer}`].join(
    "\n",
  );
}

function stripThinking(answer: string) {
  return answer.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
}

function compactText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}
