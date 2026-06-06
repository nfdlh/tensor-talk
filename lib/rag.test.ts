import { describe, expect, it } from "vitest";

import { lexicalConfidence } from "./rag";

describe("lexicalConfidence", () => {
  it("uses an absolute calibration instead of normalizing by the top hit", () => {
    expect(lexicalConfidence(20)).toBe(0.25);
    expect(lexicalConfidence(80)).toBe(1);
    expect(lexicalConfidence(120)).toBe(1);
  });
});
