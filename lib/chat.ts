export type Evidence = {
  kb_id: string;
  sourceType?: "handbook" | "web";
  source_doc?: string;
  scope_label?: string;
  section?: string;
  subsection?: string;
  pages?: number[];
  source_text?: string;
  title?: string;
  url?: string;
  domain?: string;
  sourceKind?: "page" | "pdf";
  snippet?: string;
  highlights?: string[];
  rank?: number;
  confidence?: number;
  supportScore?: number;
  supportBand?: "strong" | "moderate" | "weak";
  status?: "accepted" | "rejected";
};

export type RetrievalMode = "lexical" | "semantic" | "none";
export type WebMode = "auto" | "on" | "off";
export type WebTrustMode = "broad" | "strict";
export type HarnessMode = "tensortalk" | "openrouter";
export type ThinkingMode = "off" | "limited" | "more";

export type StageStatus = "pending" | "active" | "complete" | "error";

export type ChatStage = {
  id:
    | "planning"
    | "handbook"
    | "web"
    | "trust"
    | "generation"
    | "grounding"
    | "repair";
  label: string;
  detail?: string;
  status: StageStatus;
};

export type RejectedEvidence = {
  title?: string;
  url: string;
  domain?: string;
  reason:
    | "domain_not_allowed"
    | "fake_url_pattern"
    | "asset_url"
    | "blocked_or_empty"
    | "low_relevance";
};

export type PlannerTrace = {
  needWeb: boolean;
  queryType: string;
  answerFocus: string;
  targetKeywords: string[];
  searchQueries: string[];
  reason: string;
  source: "tensortalk" | "openrouter" | "deterministic";
  raw?: unknown;
};

export type GroundingResult = {
  passed: boolean;
  groundingScore: number;
  supportBand: "strong" | "moderate" | "weak";
  unsupportedFacts: string[];
  reason: string;
  repaired?: boolean;
};

export type ChatTrace = {
  route: {
    retrievalMode: RetrievalMode;
    webMode: WebMode;
    webTrustMode: WebTrustMode;
    harnessMode: HarnessMode;
    thinkingMode: ThinkingMode;
    usedLocal: boolean;
    usedWeb: boolean;
    modelOnly: boolean;
    fallbackRoute?: string;
  };
  planner?: PlannerTrace;
  searchedUrls: string[];
  acceptedEvidence: Evidence[];
  rejectedEvidence: RejectedEvidence[];
  grounding?: GroundingResult;
  stages: ChatStage[];
};

export type ChatRequest = {
  message: string;
  retrievalMode?: RetrievalMode;
  webMode?: WebMode;
  webTrustMode?: WebTrustMode;
  harnessMode?: HarnessMode;
  thinkingMode?: ThinkingMode;
  history?: ChatHistoryTurn[];
};

export type ChatHistoryTurn = {
  question: string;
  answer: string;
};

export type ChatContextMetadata = {
  maxContextTokens: number;
  reservedOutputTokens: number;
  estimatedInputTokens: number;
  estimatedContextUsagePercent: number;
  includedHistoryCount: number;
  omittedHistoryCount: number;
  contextTruncated: boolean;
};

export type ChatResponse = {
  answer: string;
  evidence: Evidence[];
  mode: string;
  models?: Array<{
    role: "embedding" | "chat" | "harness";
    name: string;
  }>;
  retrievalMode?: RetrievalMode;
  webMode?: WebMode;
  webTrustMode?: WebTrustMode;
  harnessMode?: HarnessMode;
  thinkingMode?: ThinkingMode;
  trace?: ChatTrace;
  grounding?: GroundingResult;
  context?: ChatContextMetadata;
  thinking?: string;
};

export type ChatStreamEvent =
  | {
      type: "stage";
      stage: ChatStage;
    }
  | {
      type: "metadata";
      evidence: Evidence[];
      mode: string;
      models?: ChatResponse["models"];
      retrievalMode?: RetrievalMode;
      webMode?: WebMode;
      webTrustMode?: WebTrustMode;
      harnessMode?: HarnessMode;
      thinkingMode?: ThinkingMode;
      trace?: ChatTrace;
      grounding?: GroundingResult;
      context?: ChatContextMetadata;
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
