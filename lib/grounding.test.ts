import { describe, expect, it } from "vitest";

import type { Evidence } from "./chat";
import { judgeGrounding, shouldKeepRepair } from "./grounding";

const evidence: Evidence[] = [
  {
    kb_id: "web-1",
    sourceType: "web",
    title: "Master of Data Science",
    url: "https://fsktm.um.edu.my/master-of-data-science",
    source_text:
      "The Master of Data Science programme is offered by FSKTM. The official page lists 42 credits.",
    supportScore: 0.9,
  },
];

describe("judgeGrounding", () => {
  it("passes answers whose exact facts appear in evidence", () => {
    const result = judgeGrounding(
      "How many credits are in the Master of Data Science?",
      "The Master of Data Science programme lists 42 credits.",
      evidence,
    );

    expect(result.passed).toBe(true);
    expect(result.groundingScore).toBeGreaterThanOrEqual(0.52);
    expect(result.unsupportedFacts).toEqual([]);
  });

  it("supports handbook page citations from evidence metadata", () => {
    const result = judgeGrounding(
      "Where is the thesis requirement listed?",
      "The thesis requirement is listed on page 42.",
      [
        {
          kb_id: "handbook-1",
          sourceType: "handbook",
          section: "Thesis Requirement",
          pages: [42],
          source_text: "The handbook section explains the thesis requirement.",
          supportScore: 0.9,
        },
      ],
    );

    expect(result.unsupportedFacts).not.toContain("42");
    expect(result.passed).toBe(true);
  });

  it("ignores numbered-list markers as exact facts", () => {
    const result = judgeGrounding(
      "How many credits are in the Master of Data Science?",
      [
        "1. The Master of Data Science programme lists 42 credits.",
        "2. It is offered by FSKTM.",
      ].join("\n"),
      evidence,
    );

    expect(result.passed).toBe(true);
    expect(result.unsupportedFacts).toEqual([]);
  });

  it("flags unsupported exact facts", () => {
    const result = judgeGrounding(
      "How many credits are in the Master of Data Science?",
      "The Master of Data Science programme lists 99 credits.",
      evidence,
    );

    expect(result.passed).toBe(false);
    expect(result.unsupportedFacts).toContain("99");
  });

  it("does not support a numeric fact by matching inside another number", () => {
    const result = judgeGrounding(
      "How many credits are in the Master of Data Science?",
      "2",
      evidence,
    );

    expect(result.unsupportedFacts).toContain("2");
    expect(result.passed).toBe(false);
  });

  it("rejects repairs that add unsupported facts even when score improves", () => {
    expect(
      shouldKeepRepair(
        {
          passed: false,
          groundingScore: 0.52,
          supportBand: "moderate",
          unsupportedFacts: ["99"],
          reason: "before",
        },
        {
          passed: false,
          groundingScore: 0.8,
          supportBand: "strong",
          unsupportedFacts: ["99", "2026"],
          reason: "after",
        },
      ),
    ).toBe(false);
  });

  it("keeps repairs that reduce unsupported facts", () => {
    expect(
      shouldKeepRepair(
        {
          passed: false,
          groundingScore: 0.52,
          supportBand: "moderate",
          unsupportedFacts: ["99", "2026"],
          reason: "before",
        },
        {
          passed: true,
          groundingScore: 0.58,
          supportBand: "moderate",
          unsupportedFacts: [],
          reason: "after",
        },
      ),
    ).toBe(true);
  });
});
