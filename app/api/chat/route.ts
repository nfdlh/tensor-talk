import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText } from "ai";

import { judgeGrounding, shouldKeepRepair } from "@/lib/grounding";
import {
  parseModelText,
  type ChatRequest,
  type ChatHistoryTurn,
  type ChatResponse,
  type ChatStage,
  type ChatStreamEvent,
  type ChatTrace,
  type Evidence,
  type GroundingResult,
  type HarnessMode,
  type PlannerTrace,
  type RetrievalMode,
  type ThinkingMode,
  type WebMode,
} from "@/lib/chat";
import {
  buildHistoryContext,
  createContextMetadata,
  EMPTY_HISTORY_BLOCK,
  estimateTokens,
  getInputTokenBudget,
} from "@/lib/context-budget";
import {
  getOpenRouterApiKey,
  getOpenRouterBaseUrl,
  getOpenRouterEmbeddingModel,
  getOpenRouterHarnessModel,
} from "@/lib/openrouter";
import {
  TENSORTALK_CITATION_RULE,
  TENSORTALK_HISTORY_RULE,
  TENSORTALK_LOCAL_EVIDENCE_RULE,
  TENSORTALK_MODEL_ONLY_RULE,
  TENSORTALK_NO_LOCAL_EVIDENCE_RULE,
  TENSORTALK_NO_WEB_EVIDENCE_RULE,
  TENSORTALK_PLANNER_SYSTEM_PROMPT,
  TENSORTALK_REPAIR_SYSTEM_PROMPT,
  TENSORTALK_SOURCE_RULES,
  TENSORTALK_SYSTEM_PROMPT,
  TENSORTALK_THINKING_RULE,
  TENSORTALK_WEB_EVIDENCE_RULE,
} from "@/lib/prompts";
import { retrieveContext } from "@/lib/rag";
import {
  applyDeterministicWebGuard,
  deterministicPlanner,
  searchOfficialWeb,
  shouldUseWebDeterministically,
} from "@/lib/web-agent";

export const runtime = "nodejs";

const DEFAULT_TENSORTALK_MODEL = "nfdlh/tensortalk-v2";
const MODEL_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 640;
const DEFAULT_MAX_THINKING_TOKENS = 180;
const TOKEN_CHAR_RATIO = 4;
const NO_THINK_RECOVERY_INSTRUCTIONS = [
  "",
  "The previous generation spent too much budget in thinking.",
  "Answer now. Do not include analysis, reasoning, or <think> tags.",
  "",
  "Final answer:",
  "/no_think",
];

type NormalizedChatRequest = Required<
  Pick<
    ChatRequest,
    "message" | "retrievalMode" | "webMode" | "harnessMode" | "thinkingMode"
  >
> & {
  history: ChatHistoryTurn[];
};

export async function POST(request: Request) {
  const chatRequest = await parseChatRequest(request);

  if (!chatRequest) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  return createChatStream(chatRequest);
}

function createChatStream(chatRequest: NormalizedChatRequest) {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const { signal } = abortController;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stages = createInitialStages();

      function write(event: ChatStreamEvent) {
        if (signal.aborted) {
          return;
        }

        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      function stage(
        id: ChatStage["id"],
        status: ChatStage["status"],
        detail?: string,
      ) {
        const index = stages.findIndex((item) => item.id === id);

        if (index === -1) {
          return;
        }

        stages[index] = {
          ...stages[index],
          status,
          ...(detail ? { detail } : {}),
        };
        write({ type: "stage", stage: stages[index] });
      }

      try {
        const response = await runChatHarness(
          chatRequest,
          stages,
          stage,
          write,
          signal,
        );

        if (!signal.aborted) {
          write({ type: "done", response });
          controller.close();
        }
      } catch (error) {
        if (!signal.aborted) {
          write({ type: "error", error: getPublicModelError(error) });
          controller.close();
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

async function runChatHarness(
  chatRequest: NormalizedChatRequest,
  stages: ChatStage[],
  stage: (
    id: ChatStage["id"],
    status: ChatStage["status"],
    detail?: string,
  ) => void,
  write: (event: ChatStreamEvent) => void,
  abortSignal: AbortSignal,
): Promise<ChatResponse> {
  const {
    message,
    retrievalMode,
    webMode,
    harnessMode,
    thinkingMode,
    history,
  } = chatRequest;
  const modelName = process.env.TENSORTALK_MODEL ?? DEFAULT_TENSORTALK_MODEL;
  const models = getModels(retrievalMode, modelName, harnessMode);
  const mode = `tensortalk-endpoint:${modelName}`;
  let handbookEvidence: Evidence[] = [];
  let webEvidence: Evidence[] = [];
  let planner: PlannerTrace | undefined;
  let searchedUrls: string[] = [];
  let rejectedEvidence: ChatTrace["rejectedEvidence"] = [];

  if (webMode === "on") {
    const localPromise = shouldUseLocal(retrievalMode)
      ? runLocalRetrieval(message, retrievalMode, stage)
      : Promise.resolve<Evidence[]>([]);
    planner = deterministicPlanner(message, []);
    const webPromise = runWebSearch(message, planner, stage, abortSignal);
    const [localResult, webResult] = await Promise.allSettled([
      localPromise,
      webPromise,
    ]);

    if (localResult.status === "fulfilled") {
      handbookEvidence = localResult.value;
    } else {
      throw localResult.reason;
    }

    if (webResult.status === "fulfilled") {
      webEvidence = webResult.value.evidence;
      searchedUrls = webResult.value.searchedUrls;
      rejectedEvidence = webResult.value.rejected;
    } else {
      throw webResult.reason;
    }
  } else {
    if (shouldUseLocal(retrievalMode)) {
      handbookEvidence = await runLocalRetrieval(message, retrievalMode, stage);
    }

    if (webMode === "auto") {
      planner = await runPlanner(
        message,
        retrievalMode,
        harnessMode,
        handbookEvidence,
        stage,
        abortSignal,
      );

      if (planner.needWeb) {
        try {
          const webResult = await runWebSearch(
            message,
            planner,
            stage,
            abortSignal,
          );
          webEvidence = webResult.evidence;
          searchedUrls = webResult.searchedUrls;
          rejectedEvidence = webResult.rejected;
        } catch (error) {
          throw error;
        }
      }
    } else {
      stage("planning", "complete", "Web search override is off.");
    }
  }

  const evidence = orderEvidence(message, handbookEvidence, webEvidence);
  const modelOnly = evidence.length === 0;

  if (needsAcceptedWebEvidence(webMode, planner) && webEvidence.length === 0) {
    throw new Error("No accepted official web evidence.");
  }

  const trace: ChatTrace = {
    route: {
      retrievalMode,
      webMode,
      harnessMode,
      thinkingMode,
      usedLocal: handbookEvidence.length > 0,
      usedWeb: webEvidence.length > 0,
      modelOnly,
    },
    ...(planner ? { planner } : {}),
    searchedUrls,
    acceptedEvidence: evidence,
    rejectedEvidence,
    stages,
  };

  const maxOutputTokens = getMaxOutputTokens(thinkingMode);
  const promptPlan = buildPrompt(
    message,
    evidence,
    retrievalMode,
    webMode,
    thinkingMode,
    history,
    maxOutputTokens,
  );

  stage(
    "planning",
    "complete",
    promptPlan.context.contextTruncated
      ? `Included ${promptPlan.context.includedHistoryCount} prior turns; omitted ${promptPlan.context.omittedHistoryCount}.`
      : `Included ${promptPlan.context.includedHistoryCount} prior turns.`,
  );
  stage("generation", "active", "Streaming TensorTalk answer.");
  write({
    type: "metadata",
    evidence,
    mode,
    models,
    retrievalMode,
    webMode,
    harnessMode,
    thinkingMode,
    trace,
    context: promptPlan.context,
  });

  const generation = await streamModelAnswer(
    promptPlan.prompt,
    modelName,
    thinkingMode,
    maxOutputTokens,
    write,
    abortSignal,
  );
  const rawText = generation.rawText;
  const { answer, thinking } = parseModelText(rawText);
  const finalThinking = truncateThinking(thinking, thinkingMode);
  let finalAnswer = answer;

  if (!finalAnswer && (generation.stoppedForThinkingLimit || thinking)) {
    stage(
      "generation",
      "active",
      generation.stoppedForThinkingLimit
        ? "Thinking limit reached; requesting final answer."
        : "No final answer after thinking; requesting direct answer.",
    );
    const recoveryMaxOutputTokens = Math.min(getMaxOutputTokens("off"), 420);
    const recoveryPromptPlan = buildPrompt(
      message,
      evidence,
      retrievalMode,
      webMode,
      "off",
      history,
      recoveryMaxOutputTokens,
      NO_THINK_RECOVERY_INSTRUCTIONS,
    );

    finalAnswer = await recoverAnswerWithoutThinking(
      recoveryPromptPlan.prompt,
      modelName,
      recoveryMaxOutputTokens,
      abortSignal,
    );
  }

  finalAnswer ??= thinking ? "The model did not return a final answer." : null;

  if (!finalAnswer) {
    throw new Error("Fine-tuned model returned an empty answer.");
  }

  stage("generation", "complete", "Answer draft complete.");
  let grounding: GroundingResult | undefined;

  if (evidence.length > 0) {
    stage("grounding", "active", "Checking exact facts against evidence.");
    grounding = judgeGrounding(message, finalAnswer, evidence);
    stage(
      "grounding",
      grounding.passed ? "complete" : "error",
      `Grounding score ${grounding.groundingScore.toFixed(2)}.`,
    );

    if (!grounding.passed) {
      stage("repair", "active", "Rewriting unsupported claims once.");
      try {
        const repaired = await repairAnswer(
          message,
          finalAnswer,
          evidence,
          modelName,
          harnessMode,
          abortSignal,
        );
        const repairedGrounding = judgeGrounding(message, repaired, evidence);

        if (shouldKeepRepair(grounding, repairedGrounding)) {
          finalAnswer = repaired;
          grounding = {
            ...repairedGrounding,
            repaired: true,
          };
          stage("repair", "complete", "Repair improved grounding.");
        } else {
          stage(
            "repair",
            "complete",
            "Original answer kept after repair check.",
          );
        }
      } catch (error) {
        if (isHarnessConfigurationError(error)) {
          throw error;
        }

        stage("repair", "error", "Repair failed; original answer kept.");
      }
    }
  } else {
    grounding = {
      passed: false,
      groundingScore: 0,
      supportBand: "weak",
      unsupportedFacts: [],
      reason: "Model-only answer; no evidence was available for grounding.",
    };
  }

  completeSkippedStages(stages, stage);
  trace.grounding = grounding;

  return {
    answer: finalAnswer,
    evidence,
    mode,
    models,
    retrievalMode,
    webMode,
    harnessMode,
    thinkingMode,
    trace,
    grounding,
    context: promptPlan.context,
    ...(finalThinking ? { thinking: finalThinking } : {}),
  };
}

async function runLocalRetrieval(
  message: string,
  retrievalMode: RetrievalMode,
  stage: (
    id: ChatStage["id"],
    status: ChatStage["status"],
    detail?: string,
  ) => void,
) {
  stage("handbook", "active", "Searching local handbook evidence.");
  const evidence = (await retrieveContext(
    message,
    retrievalMode === "semantic" ? 3 : 4,
    retrievalMode,
  )) as Evidence[];
  stage(
    "handbook",
    "complete",
    evidence.length
      ? `Accepted ${evidence.length} handbook sources.`
      : "No handbook evidence accepted.",
  );

  return evidence;
}

async function runPlanner(
  message: string,
  retrievalMode: RetrievalMode,
  harnessMode: HarnessMode,
  localEvidence: Evidence[],
  stage: (
    id: ChatStage["id"],
    status: ChatStage["status"],
    detail?: string,
  ) => void,
  abortSignal: AbortSignal,
) {
  stage("planning", "active", "Deciding whether web search is needed.");

  try {
    const planner = applyDeterministicWebGuard(
      await runHostedPlanner(
        message,
        retrievalMode,
        harnessMode,
        localEvidence,
        abortSignal,
      ),
      message,
      localEvidence,
    );

    stage(
      "planning",
      "complete",
      planner.needWeb
        ? "Planner selected official web search."
        : "Planner kept local route.",
    );

    return planner;
  } catch (error) {
    if (isHarnessConfigurationError(error)) {
      throw error;
    }

    const planner = deterministicPlanner(message, localEvidence);

    stage(
      "planning",
      "complete",
      planner.needWeb
        ? "Deterministic route selected official web search."
        : "Deterministic route kept local route.",
    );

    return planner;
  }
}

async function runWebSearch(
  message: string,
  planner: PlannerTrace,
  stage: (
    id: ChatStage["id"],
    status: ChatStage["status"],
    detail?: string,
  ) => void,
  abortSignal: AbortSignal,
) {
  stage("web", "active", "Searching official UM/FSKTM sources with Exa.");
  const webResult = await searchOfficialWeb(message, planner, abortSignal);

  stage(
    "web",
    "complete",
    webResult.evidence.length
      ? `Accepted ${webResult.evidence.length} official web sources.`
      : "No official web evidence accepted.",
  );
  stage(
    "trust",
    "complete",
    webResult.rejected.length
      ? `Rejected ${webResult.rejected.length} unsafe or weak sources.`
      : "All returned sources passed trust checks.",
  );

  return webResult;
}

async function runHostedPlanner(
  message: string,
  retrievalMode: RetrievalMode,
  harnessMode: HarnessMode,
  localEvidence: Evidence[],
  abortSignal: AbortSignal,
): Promise<PlannerTrace> {
  const modelName = process.env.TENSORTALK_MODEL ?? DEFAULT_TENSORTALK_MODEL;
  const { text } = await generateText({
    model: getHarnessModel(harnessMode, modelName),
    prompt: buildPlannerPrompt(message, retrievalMode, localEvidence),
    maxOutputTokens: 360,
    temperature: 0,
    timeout: MODEL_TIMEOUT_MS,
    abortSignal,
    maxRetries: 0,
  });
  const json = extractJson(text);

  return {
    needWeb: Boolean(json.needWeb),
    queryType: stringField(json.queryType, "official_web"),
    answerFocus: stringField(json.answerFocus, "Answer the user question."),
    targetKeywords: stringArrayField(json.targetKeywords).slice(0, 8),
    searchQueries: nonEmptyStringArray(json.searchQueries, [message]).slice(
      0,
      3,
    ),
    reason: stringField(json.reason, "Harness planner selected the route."),
    source: harnessMode,
    raw: json,
  };
}

async function streamModelAnswer(
  prompt: string,
  modelName: string,
  thinkingMode: ThinkingMode,
  maxOutputTokens: number,
  write: (event: ChatStreamEvent) => void,
  abortSignal: AbortSignal,
) {
  const thinkingBudgetChars = getThinkingBudgetChars(thinkingMode);
  const result = streamText({
    model: getTensorTalkModel(modelName),
    prompt,
    maxOutputTokens,
    temperature: 0.2,
    timeout: MODEL_TIMEOUT_MS,
    abortSignal,
    maxRetries: 1,
  });
  let rawText = "";
  let stoppedForThinkingLimit = false;

  for await (const chunk of result.textStream) {
    rawText += chunk;

    if (getOpenThinkingLength(rawText) > thinkingBudgetChars) {
      stoppedForThinkingLimit = true;
      break;
    }

    write({ type: "text", text: chunk });
  }

  return { rawText, stoppedForThinkingLimit };
}

async function recoverAnswerWithoutThinking(
  prompt: string,
  modelName: string,
  maxOutputTokens: number,
  abortSignal: AbortSignal,
) {
  try {
    const { text } = await generateText({
      model: getTensorTalkModel(modelName),
      prompt,
      maxOutputTokens,
      temperature: 0,
      timeout: MODEL_TIMEOUT_MS,
      abortSignal,
      maxRetries: 0,
    });
    const parsed = parseModelText(text);

    return parsed.answer ?? stripThinkTags(text);
  } catch {
    return null;
  }
}

async function repairAnswer(
  question: string,
  answer: string,
  evidence: Evidence[],
  modelName: string,
  harnessMode: HarnessMode,
  abortSignal: AbortSignal,
) {
  const { text } = await generateText({
    model: getHarnessModel(harnessMode, modelName),
    prompt: buildRepairPrompt(question, answer, evidence),
    maxOutputTokens: 640,
    temperature: 0.1,
    timeout: MODEL_TIMEOUT_MS,
    abortSignal,
    maxRetries: 0,
  });
  const parsed = parseModelText(text);

  return parsed.answer ?? text.trim();
}

function buildPrompt(
  message: string,
  evidence: Evidence[],
  retrievalMode: RetrievalMode,
  webMode: WebMode,
  thinkingMode: ThinkingMode,
  history: ChatHistoryTurn[] = [],
  reservedOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  extraSuffix: string[] = [],
) {
  const inputTokenBudget = getInputTokenBudget(reservedOutputTokens);
  const context = evidence.map(formatEvidenceForPrompt).join("\n\n");
  const modelOnly = evidence.length === 0;
  const promptPrefix = [
    TENSORTALK_SYSTEM_PROMPT,
    getThinkingInstruction(thinkingMode),
    TENSORTALK_HISTORY_RULE,
    retrievalMode === "none"
      ? TENSORTALK_NO_LOCAL_EVIDENCE_RULE
      : TENSORTALK_LOCAL_EVIDENCE_RULE,
    webMode === "off"
      ? TENSORTALK_NO_WEB_EVIDENCE_RULE
      : TENSORTALK_WEB_EVIDENCE_RULE,
    ...TENSORTALK_SOURCE_RULES,
    modelOnly ? TENSORTALK_MODEL_ONLY_RULE : TENSORTALK_CITATION_RULE,
    "",
    modelOnly ? "Accepted evidence: none." : context,
    "",
    "Conversation history:",
  ];
  const promptSuffix = ["", `Question: ${message}`, ...extraSuffix];
  const fixedPrompt = [
    ...promptPrefix,
    EMPTY_HISTORY_BLOCK,
    ...promptSuffix,
  ].join("\n");
  const availableHistoryTokens = inputTokenBudget - estimateTokens(fixedPrompt);

  if (availableHistoryTokens < 0) {
    throw new Error("Context budget exhausted.");
  }

  const historyContext = buildHistoryContext(history, availableHistoryTokens);
  const prompt = [...promptPrefix, historyContext.block, ...promptSuffix].join(
    "\n",
  );
  const estimatedInputTokens = estimateTokens(prompt);

  if (estimatedInputTokens > inputTokenBudget) {
    throw new Error("Context budget exhausted.");
  }

  return {
    prompt,
    context: createContextMetadata(
      estimatedInputTokens,
      historyContext,
      reservedOutputTokens,
    ),
  };
}

function getThinkingInstruction(thinkingMode: ThinkingMode) {
  const budgetTokens = getThinkingBudgetTokens(thinkingMode);

  if (thinkingMode === "off") {
    return [
      "Thinking mode: off.",
      "Return the final answer directly. Do not output <think> blocks, analysis, or hidden reasoning.",
      "If the model still starts a <think> block, close it immediately and provide the final answer. /no_think",
    ].join(" ");
  }

  if (thinkingMode === "more") {
    return [
      "Thinking mode: more.",
      `If reasoning is needed, keep any <think> block under ${budgetTokens} tokens, close </think>, then provide the final answer.`,
      "Do not spend the full answer budget on thinking.",
    ].join(" ");
  }

  return [
    "Thinking mode: limited.",
    `Return the final answer directly when possible. If the model starts a <think> block, keep it under ${budgetTokens} tokens, close </think>, then provide the final answer.`,
    "/no_think",
  ].join(" ");
}

function buildPlannerPrompt(
  message: string,
  retrievalMode: RetrievalMode,
  localEvidence: Evidence[],
) {
  const localSummary = localEvidence
    .map((item, index) =>
      [
        `Local ${index + 1}: ${item.section ?? item.title ?? "evidence"}`,
        `Support: ${(item.supportScore ?? 0).toFixed(2)}`,
        `Text: ${(item.source_text ?? item.snippet ?? "").slice(0, 320)}`,
      ].join("\n"),
    )
    .join("\n\n");

  return [
    TENSORTALK_PLANNER_SYSTEM_PROMPT,
    TENSORTALK_THINKING_RULE,
    "Decide if the answer needs official UM/FSKTM web search.",
    "Use web for current/latest deadlines, fees, intake, admissions, contacts, announcements, events, staff, labs, facilities, programme pages, portals, libraries, careers, or weak/no local evidence.",
    "Return JSON only with keys: needWeb, queryType, answerFocus, targetKeywords, searchQueries, reason.",
    "",
    `Retrieval mode: ${retrievalMode}`,
    localSummary
      ? `Local evidence summary:\n${localSummary}`
      : "Local evidence summary: none.",
    "",
    `Question: ${message}`,
  ].join("\n");
}

function buildRepairPrompt(
  question: string,
  answer: string,
  evidence: Evidence[],
) {
  return [
    TENSORTALK_REPAIR_SYSTEM_PROMPT,
    TENSORTALK_THINKING_RULE,
    "Use only the accepted evidence as authority.",
    "Remove or qualify any unsupported exact facts.",
    "Keep the answer concise.",
    "",
    evidence.map(formatEvidenceForPrompt).join("\n\n"),
    "",
    `Question: ${question}`,
    "",
    `Draft answer to repair:\n${answer}`,
  ].join("\n");
}

function formatEvidenceForPrompt(item: Evidence, index: number) {
  if (item.sourceType === "web") {
    return [
      `Evidence ${index + 1} - Official web`,
      `Title: ${item.title ?? "Official UM source"}`,
      `URL: ${item.url}`,
      `Domain: ${item.domain}`,
      `Kind: ${item.sourceKind ?? "page"}`,
      `Support: ${(item.supportScore ?? 0).toFixed(2)}`,
      `Text: ${item.source_text ?? item.snippet ?? ""}`,
    ].join("\n");
  }

  return [
    `Evidence ${index + 1} - Handbook`,
    `Source: ${item.source_doc ?? "UM Handbook"}`,
    `Scope: ${item.scope_label ?? "unknown"}`,
    `Section: ${item.section ?? "unknown"}`,
    `Subsection: ${item.subsection ?? "unknown"}`,
    `Pages: ${item.pages?.join(", ") ?? "unknown"}`,
    `Support: ${(item.supportScore ?? 0).toFixed(2)}`,
    `Text: ${item.source_text ?? ""}`,
  ].join("\n");
}

function orderEvidence(
  question: string,
  handbookEvidence: Evidence[],
  webEvidence: Evidence[],
) {
  if (shouldUseWebDeterministically(question, handbookEvidence)) {
    return [...webEvidence, ...handbookEvidence];
  }

  return [...handbookEvidence, ...webEvidence];
}

function getTensorTalkModel(modelName: string) {
  const baseURL = process.env.TENSORTALK_API_BASE_URL;
  const apiKey =
    process.env.TENSORTALK_API_KEY ??
    process.env.HUGGINGFACE_API_KEY ??
    process.env.HF_TOKEN;

  if (!baseURL) {
    throw new Error("Missing TENSORTALK_API_BASE_URL.");
  }

  return createOpenAICompatible({
    name: "tensortalk",
    baseURL,
    apiKey,
  })(modelName);
}

function getOpenRouterChatModel(modelName: string) {
  const apiKey = getOpenRouterApiKey();

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY for harness.");
  }

  return createOpenAICompatible({
    name: "openrouter",
    baseURL: getOpenRouterBaseUrl(),
    apiKey,
  })(modelName);
}

function getHarnessModel(
  harnessMode: HarnessMode,
  tensorTalkModelName: string,
) {
  return harnessMode === "openrouter"
    ? getOpenRouterChatModel(getOpenRouterHarnessModel())
    : getTensorTalkModel(tensorTalkModelName);
}

function getModels(
  retrievalMode: RetrievalMode,
  modelName: string,
  harnessMode: HarnessMode,
): ChatResponse["models"] {
  const harnessModel =
    harnessMode === "openrouter" ? getOpenRouterHarnessModel() : modelName;
  const models: ChatResponse["models"] = [{ role: "chat", name: modelName }];

  if (retrievalMode === "semantic") {
    models.unshift({ role: "embedding", name: getOpenRouterEmbeddingModel() });
  }

  models.push({ role: "harness", name: harnessModel });

  return models;
}

function getMaxOutputTokens(thinkingMode: ThinkingMode = "limited") {
  const baseTokens = getPositiveIntegerEnv(
    "TENSORTALK_MAX_OUTPUT_TOKENS",
    DEFAULT_MAX_OUTPUT_TOKENS,
  );

  return thinkingMode === "more" ? Math.max(baseTokens, 1024) : baseTokens;
}

function getThinkingBudgetTokens(thinkingMode: ThinkingMode = "limited") {
  const baseTokens = getPositiveIntegerEnv(
    "TENSORTALK_MAX_THINKING_TOKENS",
    DEFAULT_MAX_THINKING_TOKENS,
  );

  if (thinkingMode === "off") {
    return Math.min(baseTokens, 24);
  }

  if (thinkingMode === "more") {
    return Math.max(baseTokens * 2, 360);
  }

  return baseTokens;
}

function getThinkingBudgetChars(thinkingMode: ThinkingMode = "limited") {
  return getThinkingBudgetTokens(thinkingMode) * TOKEN_CHAR_RATIO;
}

function getPositiveIntegerEnv(name: string, fallback: number) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getOpenThinkingLength(text: string) {
  const lowerText = text.toLowerCase();
  const openIndex = lowerText.lastIndexOf("<think>");

  if (openIndex === -1) {
    return 0;
  }

  const closeIndex = lowerText.indexOf("</think>", openIndex);

  if (closeIndex !== -1) {
    return 0;
  }

  return text.length - openIndex - "<think>".length;
}

function truncateThinking(
  thinking: string | null,
  thinkingMode: ThinkingMode = "limited",
) {
  if (!thinking) {
    return undefined;
  }

  const maxChars = getThinkingBudgetChars(thinkingMode);

  if (thinking.length <= maxChars) {
    return thinking;
  }

  return `${thinking.slice(0, maxChars).trim()}\n\n[Thinking truncated after ${getThinkingBudgetTokens(thinkingMode)} tokens.]`;
}

function stripThinkTags(text: string) {
  return text
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/<\/think>/gi, "")
    .trim();
}

function shouldUseLocal(retrievalMode: RetrievalMode) {
  return retrievalMode !== "none";
}

function needsAcceptedWebEvidence(
  webMode: WebMode,
  planner: PlannerTrace | undefined,
) {
  return webMode === "on" || (webMode === "auto" && planner?.needWeb);
}

function createInitialStages(): ChatStage[] {
  return [
    { id: "planning", label: "Planning route", status: "pending" },
    {
      id: "handbook",
      label: "Retrieving handbook evidence",
      status: "pending",
    },
    { id: "web", label: "Searching official UM/FSKTM web", status: "pending" },
    { id: "trust", label: "Checking source trust", status: "pending" },
    { id: "generation", label: "Generating answer", status: "pending" },
    { id: "grounding", label: "Verifying grounding", status: "pending" },
    { id: "repair", label: "Repairing answer", status: "pending" },
  ];
}

function completeSkippedStages(
  stages: ChatStage[],
  stage: (
    id: ChatStage["id"],
    status: ChatStage["status"],
    detail?: string,
  ) => void,
) {
  for (const item of stages) {
    if (item.status === "pending") {
      stage(item.id, "complete", "Skipped for this route.");
    }
  }
}

async function parseChatRequest(request: Request) {
  try {
    const body: unknown = (await request.json()) as ChatRequest;

    if (
      !body ||
      typeof body !== "object" ||
      !("message" in body) ||
      typeof body.message !== "string"
    ) {
      return null;
    }

    const payload = body as Partial<ChatRequest>;
    const message = payload.message?.trim() ?? "";
    const retrievalMode = parseRetrievalMode(payload.retrievalMode);
    const webMode = parseWebMode(payload.webMode);
    const harnessMode = parseHarnessMode(payload.harnessMode);
    const thinkingMode = parseThinkingMode(payload.thinkingMode);
    const history = normalizeHistory(payload.history);

    return message
      ? { message, retrievalMode, webMode, harnessMode, thinkingMode, history }
      : null;
  } catch {
    return null;
  }
}

function normalizeHistory(history: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const turn = item as Partial<ChatHistoryTurn>;
      const question =
        typeof turn.question === "string" ? turn.question.trim() : "";
      const answer = typeof turn.answer === "string" ? turn.answer.trim() : "";

      return question && answer ? { question, answer } : null;
    })
    .filter((item): item is ChatHistoryTurn => Boolean(item))
    .slice(-24);
}

function parseRetrievalMode(mode: unknown): RetrievalMode {
  return mode === "lexical" || mode === "semantic" || mode === "none"
    ? mode
    : "semantic";
}

function parseWebMode(mode: unknown): WebMode {
  return mode === "on" || mode === "off" || mode === "auto" ? mode : "auto";
}

function parseHarnessMode(mode: unknown): HarnessMode {
  return mode === "openrouter" || mode === "tensortalk" ? mode : "tensortalk";
}

function parseThinkingMode(mode: unknown): ThinkingMode {
  return mode === "off" || mode === "more" || mode === "limited"
    ? mode
    : "limited";
}

function extractJson(text: string): Record<string, unknown> {
  const parsed = parseModelText(text).answer ?? text;
  const match = parsed.match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error("Planner did not return JSON.");
  }

  return JSON.parse(match[0]) as Record<string, unknown>;
}

function stringField(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArrayField(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nonEmptyStringArray(value: unknown, fallback: string[]) {
  const parsed = stringArrayField(value)
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

function getPublicModelError(error: unknown) {
  if (
    error instanceof Error &&
    error.message === "Missing TENSORTALK_API_BASE_URL."
  ) {
    return "TENSORTALK_API_BASE_URL is required because nfdlh/tensortalk-v2 is uploaded to Hugging Face Hub but still needs an inference endpoint.";
  }

  if (
    error instanceof Error &&
    error.message === "Missing OPENROUTER_API_KEY."
  ) {
    return "OPENROUTER_API_KEY is required for the semantic vector implementation.";
  }

  if (
    error instanceof Error &&
    error.message === "Missing OPENROUTER_API_KEY for harness."
  ) {
    return "OPENROUTER_API_KEY is required when the harness model is set to OpenRouter Qwen.";
  }

  if (error instanceof Error && error.message === "Missing EXA_API_KEY.") {
    return "EXA_API_KEY is required when official web search is turned on or selected by Auto.";
  }

  if (
    error instanceof Error &&
    error.message === "No accepted official web evidence."
  ) {
    return "No accepted official UM/FSKTM web evidence was found. Try another question or retry later.";
  }

  if (error instanceof Error && error.message === "Context budget exhausted.") {
    return "The safe 8192-token context budget is exhausted. Shorten the question or start a new chat so older context can be omitted.";
  }

  if (
    error instanceof Error &&
    (error.message.startsWith("Missing data/UM_RAG_Vectors.sqlite") ||
      error.message.startsWith("Semantic vector index"))
  ) {
    return "The semantic vector index is missing or incompatible. Run `pnpm rag:index` after setting OPENROUTER_API_KEY.";
  }

  if (error instanceof Error && error.message.includes("OpenRouter")) {
    return "OpenRouter could not complete the semantic chat request.";
  }

  if (error instanceof Error && error.message.includes("Exa")) {
    return "Exa could not complete the official web search request.";
  }

  return "The fine-tuned TensorTalk model could not be reached.";
}

function isHarnessConfigurationError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === "Missing OPENROUTER_API_KEY for harness."
  );
}
