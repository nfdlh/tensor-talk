import { describe, expect, it } from "vitest";

import {
  buildHistoryContext,
  createContextMetadata,
  EMPTY_HISTORY_BLOCK,
  estimateTokens,
  MAX_CONTEXT_TOKENS,
  RESERVED_OUTPUT_TOKENS,
} from "./context-budget";

describe("buildHistoryContext", () => {
  it("prioritizes newer turns when history does not fit", () => {
    const history = [
      { question: "old question", answer: "old answer ".repeat(120) },
      { question: "middle question", answer: "middle answer ".repeat(120) },
      { question: "new question", answer: "new answer" },
    ];
    const result = buildHistoryContext(history, 24);

    expect(result.block).toContain("new question");
    expect(result.block).not.toContain("old question");
    expect(result.includedHistoryCount).toBe(1);
    expect(result.omittedHistoryCount).toBe(2);
    expect(result.contextTruncated).toBe(true);
  });

  it("accounts for separators before adding another history turn", () => {
    const history = [
      { question: "middle question", answer: "middle answer" },
      { question: "new question", answer: "new answer" },
    ];
    const budgetWithoutSeparator =
      estimateTokens(formatHistoryForTest(history[0])) +
      estimateTokens(formatHistoryForTest(history[1])) +
      estimateTokens("\n\n") -
      1;
    const result = buildHistoryContext(history, budgetWithoutSeparator);

    expect(result.block).toContain("new question");
    expect(result.block).not.toContain("middle question");
    expect(estimateTokens(result.block)).toBeLessThanOrEqual(
      budgetWithoutSeparator,
    );
    expect(result.includedHistoryCount).toBe(1);
    expect(result.omittedHistoryCount).toBe(1);
  });

  it("does not include older turns after a newer turn is omitted", () => {
    const history = [
      { question: "old question", answer: "short old answer" },
      { question: "new question", answer: "new answer ".repeat(120) },
    ];
    const budgetThatOnlyFitsOld = estimateTokens(
      formatHistoryForTest(history[0]),
    );
    const result = buildHistoryContext(history, budgetThatOnlyFitsOld);

    expect(result.block).toBe(EMPTY_HISTORY_BLOCK);
    expect(result.includedHistoryCount).toBe(0);
    expect(result.omittedHistoryCount).toBe(2);
    expect(result.contextTruncated).toBe(true);
  });

  it("uses an empty block when no history fits", () => {
    const result = buildHistoryContext([], 0);

    expect(result.block).toBe(EMPTY_HISTORY_BLOCK);
    expect(result.includedHistoryCount).toBe(0);
    expect(result.omittedHistoryCount).toBe(0);
    expect(result.contextTruncated).toBe(false);
  });
});

describe("createContextMetadata", () => {
  it("reports reserved output and total context usage", () => {
    const metadata = createContextMetadata(estimateTokens("x".repeat(1200)), {
      includedHistoryCount: 2,
      omittedHistoryCount: 1,
      contextTruncated: true,
    });

    expect(metadata.maxContextTokens).toBe(MAX_CONTEXT_TOKENS);
    expect(metadata.reservedOutputTokens).toBe(RESERVED_OUTPUT_TOKENS);
    expect(metadata.includedHistoryCount).toBe(2);
    expect(metadata.omittedHistoryCount).toBe(1);
    expect(metadata.contextTruncated).toBe(true);
    expect(metadata.estimatedContextUsagePercent).toBeGreaterThan(0);
  });
});

function formatHistoryForTest(turn: { question: string; answer: string }) {
  return [`Previous question: ${turn.question}`, `Previous answer: ${turn.answer}`].join(
    "\n",
  );
}
