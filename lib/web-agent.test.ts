import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDeterministicWebGuard,
  searchOfficialWeb,
  supportBand,
  validateOfficialUrl,
} from "./web-agent";

const originalFetch = globalThis.fetch;
const originalExaKey = process.env.EXA_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.EXA_API_KEY = originalExaKey;
  vi.restoreAllMocks();
});

describe("validateOfficialUrl", () => {
  it("accepts official pages and PDFs", () => {
    expect(validateOfficialUrl("https://fsktm.um.edu.my/programmes")).toMatchObject({
      accepted: true,
      domain: "fsktm.um.edu.my",
      sourceKind: "page",
    });
    expect(
      validateOfficialUrl("https://www.um.edu.my/docs/admission.pdf"),
    ).toMatchObject({
      accepted: true,
      domain: "www.um.edu.my",
      sourceKind: "pdf",
    });
    expect(validateOfficialUrl("https://um.edu.my/admissions")).toMatchObject({
      accepted: true,
      domain: "um.edu.my",
      sourceKind: "page",
    });
    expect(
      validateOfficialUrl(
        "https://handbook2018e.fsktm.um.edu.my/files/assets/basic-html/page202.html",
      ),
    ).toMatchObject({
      accepted: true,
      domain: "handbook2018e.fsktm.um.edu.my",
      sourceKind: "page",
    });
  });

  it("rejects non-allowlisted, fake, and asset URLs", () => {
    expect(validateOfficialUrl("https://example.com/fsktm")).toMatchObject({
      accepted: false,
      reason: "domain_not_allowed",
    });
    expect(validateOfficialUrl("not a url")).toMatchObject({
      accepted: false,
      reason: "fake_url_pattern",
    });
    expect(validateOfficialUrl("https://fsktm.um.edu.my/logo.png")).toMatchObject({
      accepted: false,
      reason: "asset_url",
    });
  });
});

describe("supportBand", () => {
  it("matches TensorTalk-style thresholds", () => {
    expect(supportBand(0.72)).toBe("strong");
    expect(supportBand(0.52)).toBe("moderate");
    expect(supportBand(0.51)).toBe("weak");
  });
});

describe("applyDeterministicWebGuard", () => {
  it("prevents the hosted planner from downgrading required web routes", () => {
    const planner = applyDeterministicWebGuard(
      {
        needWeb: false,
        queryType: "handbook_or_model",
        answerFocus: "Use local handbook evidence.",
        targetKeywords: ["fee"],
        searchQueries: [],
        reason: "Hosted planner kept local route.",
        source: "hosted-model",
      },
      "What is the current admission fee?",
      [{ kb_id: "weak", sourceType: "handbook", supportScore: 0.2 }],
    );

    expect(planner.needWeb).toBe(true);
    expect(planner.queryType).toBe("official_web");
    expect(planner.searchQueries).toEqual(["What is the current admission fee?"]);
    expect(planner.reason).toContain("Deterministic guard required");
  });
});

describe("searchOfficialWeb", () => {
  it("requires an Exa API key", async () => {
    process.env.EXA_API_KEY = "";

    await expect(
      searchOfficialWeb("parking", {
        searchQueries: ["parking"],
        targetKeywords: ["parking"],
      }),
    ).rejects.toThrow("Missing EXA_API_KEY.");
  });

  it("rejects unscored results with no question overlap", async () => {
    process.env.EXA_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Campus parking",
              url: "https://fsktm.um.edu.my/parking",
              text: "Campus parking shuttle maps and vehicle entry notices.",
              highlights: [],
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await searchOfficialWeb("industrial training requirements", {
      searchQueries: ["industrial training requirements"],
      targetKeywords: ["industrial", "training"],
    });

    expect(result.evidence).toHaveLength(0);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: "low_relevance" }),
    ]);
  });
});
