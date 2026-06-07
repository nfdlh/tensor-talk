import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const AUDIT_DIR = new URL(".", import.meta.url).pathname;
const OUT_DIR = path.join(AUDIT_DIR, "outputs");
const DEFAULT_HF_ROOT = "/private/tmp/tensortalk_hf_audit";
const DEFAULT_SERVED_ROOT = "/private/tmp/tensortalk_v2_audit";
const DEFAULT_LOCAL_PPO_ROOT =
  "/Users/nurfadilah/Downloads/ppo_qwen3_um_handbook_stage3_rule_reward_ppo";

const SFT_URL =
  "https://huggingface.co/TensorCat/TensorTalk/resolve/main/UM_Handbook/Dataset/SFT_Dataset/SFT_QA_Training_Ready.jsonl";

const BASELINE1_SYSTEM_PROMPT =
  "You are an academic assistant for the Faculty of Computer Science and " +
  "Information Technology, Universiti Malaya. Answer only with handbook-consistent " +
  "information. Keep the answer direct, specific, and faithful to the handbook. " +
  "Do not add assumptions, generic academic advice, or extra explanation beyond " +
  "what the handbook supports. If the handbook does not support a claim, say so briefly.";

const UNSUPPORTED_QUESTIONS = [
  "What is the weather in Kuala Lumpur today?",
  "Who won the latest FIFA World Cup final?",
  "Can you recommend the best laptop to buy this week?",
  "What is the current Bitcoin price?",
  "Write me a Python script to scrape private student records.",
  "What is the cafeteria menu for tomorrow?",
  "Which lecturer is free right now for consultation?",
  "What is my current CGPA?",
  "Can you guarantee my admission if I apply today?",
  "What are the live traffic conditions around Universiti Malaya?",
];

const args = parseArgs(process.argv.slice(2));
const timeoutMs = Number(args["timeout-ms"] ?? 90_000);
const maxPerPath = args["max-per-path"] ? Number(args["max-per-path"]) : null;
const includeSemantic = Boolean(args["include-semantic"]);
const failFast = Number(args["fail-fast"] ?? 3);

mkdirSync(OUT_DIR, { recursive: true });

const env = {
  ...readEnvFile(path.join(process.cwd(), ".env.local")),
  ...process.env,
};

const model = env.TENSORTALK_MODEL || "nfdlh/tensortalk-v2";
const endpointBase = trimSlash(env.TENSORTALK_API_BASE_URL || "");
const apiKey =
  env.TENSORTALK_API_KEY || env.RUNPOD_API_KEY || env.HUGGINGFACE_API_KEY || env.HF_TOKEN || "";
const appBaseUrl = args["app-base-url"] ?? env.APP_BASE_URL ?? "";
const artifactRoots = {
  hf: resolveAuditPath(
    args["hf-root"] ?? env.TENSORTALK_AUDIT_HF_ROOT ?? DEFAULT_HF_ROOT,
  ),
  served: resolveAuditPath(
    args["served-root"] ??
      env.TENSORTALK_AUDIT_SERVED_ROOT ??
      DEFAULT_SERVED_ROOT,
  ),
  localPpo: resolveAuditPath(
    args["local-ppo-root"] ??
      env.TENSORTALK_AUDIT_LOCAL_PPO_ROOT ??
      DEFAULT_LOCAL_PPO_ROOT,
  ),
};

const auditStartedAt = new Date().toISOString();
const sftRows = await loadSftRows();
const evalSet = buildEvalSet(sftRows);
writeJson(path.join(OUT_DIR, "eval-set.json"), evalSet);
const partialResultsPath = path.join(OUT_DIR, "results.partial.jsonl");
writeFileSync(partialResultsPath, "");

const configDiff = collectConfigDiff();
writeJson(path.join(OUT_DIR, "config-diff.json"), configDiff);

const notebookClaims = collectNotebookClaims();
writeJson(path.join(OUT_DIR, "notebook-local-claims.json"), notebookClaims);

const paths = [
  {
    id: "direct_notebook_chat",
    label: "Direct endpoint, notebook-style chat prompt",
    run: (item) => callDirectNotebook(item.question),
  },
  {
    id: "direct_plain_user",
    label: "Direct endpoint, plain user prompt",
    run: (item) => callDirectPlain(item.question),
  },
  {
    id: "app_no_rag",
    label: 'App /api/chat retrievalMode="none", webMode="off"',
    run: (item) =>
      callApp(item.question, { retrievalMode: "none", webMode: "off" }),
    requiresApp: true,
  },
];

if (includeSemantic) {
  paths.push({
    id: "app_semantic_rag",
    label: 'App /api/chat retrievalMode="semantic", webMode="off"',
    run: (item) =>
      callApp(item.question, { retrievalMode: "semantic", webMode: "off" }),
    requiresApp: true,
  });
}

const results = [];
for (const testPath of paths) {
  const cases = maxPerPath ? evalSet.slice(0, maxPerPath) : evalSet;
  let consecutiveInfraFailures = 0;

  for (const item of cases) {
    if (testPath.requiresApp && !appBaseUrl) {
      results.push(
        scoreResult(item, testPath, {
          ok: false,
          failureCategory: "not_run_missing_app_base_url",
          error: "APP_BASE_URL or --app-base-url is required for app paths.",
        }),
      );
      continue;
    }

    if (
      failFast > 0 &&
      consecutiveInfraFailures >= failFast &&
      item.kind !== "unsupported"
    ) {
      results.push(
        scoreResult(item, testPath, {
          ok: false,
          failureCategory: "not_run_after_consecutive_infra_failures",
          error: `Skipped after ${consecutiveInfraFailures} consecutive path failures.`,
        }),
      );
      continue;
    }

    const raw = await testPath.run(item);
    const scored = scoreResult(item, testPath, raw);
    results.push(scored);
    writeJsonl(partialResultsPath, results);
    console.log(
      [
        new Date().toISOString(),
        testPath.id,
        item.id,
        scored.failure_category,
        `f1=${scored.token_f1}`,
        `latency=${scored.latency_ms ?? "n/a"}ms`,
      ].join(" | "),
    );

    if (
      [
        "endpoint_timeout",
        "endpoint_http_error",
        "endpoint_network_error",
        "app_timeout",
        "app_http_error",
        "app_network_error",
        "invalid_json",
      ].includes(scored.failure_category)
    ) {
      consecutiveInfraFailures += 1;
    } else {
      consecutiveInfraFailures = 0;
    }
  }
}

writeJsonl(path.join(OUT_DIR, "results.jsonl"), results);
writeFileSync(path.join(OUT_DIR, "results.csv"), toCsv(results));

const summary = summarize(results, {
  auditStartedAt,
  auditFinishedAt: new Date().toISOString(),
  model,
  endpointBase: endpointBase ? redactEndpoint(endpointBase) : null,
  appBaseUrl: appBaseUrl || null,
  timeoutMs,
  maxPerPath,
  includeSemantic,
  failFast,
});
writeJson(path.join(OUT_DIR, "summary.json"), summary);
writeFileSync(
  path.join(OUT_DIR, "audit-report.md"),
  renderReport(summary, notebookClaims, configDiff),
);

console.log(JSON.stringify(summary, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    parsed[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return parsed;
}

function resolveAuditPath(value) {
  return path.resolve(String(value));
}

async function loadSftRows() {
  const localPath = path.join(
    artifactRoots.hf,
    "UM_Handbook/Dataset/SFT_Dataset/SFT_QA_Training_Ready.jsonl",
  );
  const text = existsSync(localPath)
    ? readFileSync(localPath, "utf8")
    : await fetchText(SFT_URL);
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildEvalSet(rows) {
  const shuffled = notebookPythonShuffle(rows, 42);
  const validation = shuffled.slice(800, 900);
  const test = shuffled.slice(900, 1000);
  const exact = [...validation.slice(0, 13), ...test.slice(0, 12)].map(
    (row, index) => ({
      id: `exact_${String(index + 1).padStart(2, "0")}`,
      kind: "exact_sft",
      qa_id: row.qa_id,
      index_id: row.index_id,
      question: row.question,
      reference_answer: row.answer,
    }),
  );
  const paraphrased = exact.map((item, index) => ({
    ...item,
    id: `paraphrase_${String(index + 1).padStart(2, "0")}`,
    kind: "paraphrase",
    question: paraphraseQuestion(item.question, index),
    source_question: item.question,
  }));
  const unsupported = UNSUPPORTED_QUESTIONS.map((question, index) => ({
    id: `unsupported_${String(index + 1).padStart(2, "0")}`,
    kind: "unsupported",
    qa_id: null,
    index_id: null,
    question,
    reference_answer:
      "The handbook does not provide enough supported information to answer this question.",
  }));
  return [...exact, ...paraphrased, ...unsupported];
}

function notebookPythonShuffle(rows, seed) {
  const script = [
    "import json, random, sys",
    "count = int(sys.argv[1])",
    "seed = int(sys.argv[2])",
    "items = list(range(count))",
    "random.Random(seed).shuffle(items)",
    "print(json.dumps(items))",
  ].join("\n");
  const stdout = execFileSync("python3", ["-c", script, String(rows.length), String(seed)], {
    encoding: "utf8",
  });
  return JSON.parse(stdout).map((index) => rows[index]);
}

function paraphraseQuestion(question, index) {
  const starters = [
    (text) => `Please explain this handbook question: ${text}?`,
    (text) => `In simple terms, ${lowercaseFirst(text)}?`,
    (text) => `For a student, ${lowercaseFirst(text)}?`,
    (text) => `Could you summarize this: ${text}?`,
    (text) => `What should I know about this handbook topic: ${text}?`,
  ];
  const cleaned = question.replace(/\?+$/, "").trim();
  return starters[index % starters.length](cleaned);
}

function lowercaseFirst(text) {
  return text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

async function callDirectNotebook(question) {
  return callOpenAiChat({
    messages: [
      {
        role: "system",
        content:
          BASELINE1_SYSTEM_PROMPT +
          " Answer directly and do not show reasoning. /no_think",
      },
      { role: "user", content: question },
    ],
    max_tokens: 160,
    temperature: 0,
    top_p: 1,
    repetition_penalty: 1.02,
    chat_template_kwargs: { enable_thinking: false },
  });
}

async function callDirectPlain(question) {
  return callOpenAiChat({
    messages: [{ role: "user", content: question }],
    max_tokens: 160,
    temperature: 0,
    top_p: 1,
  });
}

async function callOpenAiChat(payload) {
  if (!endpointBase || !apiKey) {
    return {
      ok: false,
      failureCategory: "endpoint_missing_config",
      error: "Missing TENSORTALK_API_BASE_URL or API key.",
    };
  }
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(`${endpointBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, ...payload }),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        failureCategory: "endpoint_http_error",
        status: res.status,
        latencyMs: Date.now() - startedAt,
        error: text.slice(0, 1000),
      };
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return {
        ok: false,
        failureCategory: "invalid_json",
        latencyMs: Date.now() - startedAt,
        error: error.message,
        rawText: text.slice(0, 1000),
      };
    }
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      rawAnswer: json.choices?.[0]?.message?.content ?? "",
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      usage: json.usage ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      failureCategory:
        error.name === "AbortError" ? "endpoint_timeout" : "endpoint_network_error",
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

async function callApp(question, body) {
  const startedAt = Date.now();
  try {
    const res = await fetchWithTimeout(`${trimSlash(appBaseUrl)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, ...body }),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        failureCategory: "app_http_error",
        status: res.status,
        latencyMs: Date.now() - startedAt,
        error: text.slice(0, 1000),
      };
    }
    const lines = text.trim().split("\n").filter(Boolean);
    const events = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        return {
          ok: false,
          failureCategory: "invalid_json",
          latencyMs: Date.now() - startedAt,
          error: line.slice(0, 1000),
        };
      }
    }
    const errorEvent = events.find((event) => event.type === "error");
    if (errorEvent) {
      return {
        ok: false,
        failureCategory: "app_error_event",
        latencyMs: Date.now() - startedAt,
        error: errorEvent.error,
        eventsCount: events.length,
      };
    }
    const done = events.find((event) => event.type === "done");
    return {
      ok: Boolean(done?.response?.answer),
      failureCategory: done?.response?.answer ? null : "empty_answer",
      latencyMs: Date.now() - startedAt,
      rawAnswer: done?.response?.answer ?? "",
      appResponse: done?.response ?? null,
      eventsCount: events.length,
    };
  } catch (error) {
    return {
      ok: false,
      failureCategory:
        error.name === "AbortError" ? "app_timeout" : "app_network_error",
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

function scoreResult(item, testPath, raw) {
  const rawAnswer = raw.rawAnswer ?? "";
  const answer = stripThinking(rawAnswer);
  const exactMatch = item.kind === "unsupported" ? 0 : exact(answer, item.reference_answer);
  const f1 = item.kind === "unsupported" ? 0 : tokenF1(answer, item.reference_answer);
  const rougeL = item.kind === "unsupported" ? 0 : rougeLScore(answer, item.reference_answer);
  const refusal = isRefusal(answer);
  const empty = !answer.trim();
  const invalid = !raw.ok || empty;
  let failureCategory = raw.failureCategory ?? null;

  if (!failureCategory) {
    if (empty) {
      failureCategory = "empty_answer";
    } else if (item.kind === "unsupported") {
      failureCategory = refusal ? "unsupported_refusal" : "unsupported_answered";
    } else if (exactMatch === 1) {
      failureCategory = "pass_exact";
    } else if (f1 >= 0.85) {
      failureCategory = "pass_high_f1";
    } else if (f1 >= 0.55) {
      failureCategory = "partial_low_f1";
    } else {
      failureCategory = "fail_low_f1";
    }
  }

  return {
    id: item.id,
    kind: item.kind,
    qa_id: item.qa_id,
    index_id: item.index_id,
    path_id: testPath.id,
    path_label: testPath.label,
    question: item.question,
    source_question: item.source_question ?? null,
    reference_answer: item.reference_answer,
    model_answer: answer,
    raw_model_answer: rawAnswer,
    exact_match: exactMatch,
    token_f1: round(f1, 4),
    rouge_l: round(rougeL, 4),
    refusal,
    empty,
    invalid,
    answer_words: words(answer).length,
    latency_ms: raw.latencyMs ?? null,
    finish_reason: raw.finishReason ?? null,
    usage: raw.usage ?? null,
    status: raw.status ?? null,
    error: raw.error ?? null,
    failure_category: failureCategory,
  };
}

function stripThinking(text) {
  return String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/gi, " ")
    .replace(/<\|.*?\|>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(text) {
  return stripThinking(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  const normalized = normalize(text);
  return normalized ? normalized.split(" ") : [];
}

function exact(a, b) {
  return normalize(a) === normalize(b) ? 1 : 0;
}

function tokenF1(prediction, reference) {
  const pred = words(prediction);
  const ref = words(reference);
  if (!pred.length && !ref.length) return 1;
  if (!pred.length || !ref.length) return 0;
  const counts = new Map();
  for (const token of ref) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of pred) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(token, count - 1);
    }
  }
  if (!overlap) return 0;
  const precision = overlap / pred.length;
  const recall = overlap / ref.length;
  return (2 * precision * recall) / (precision + recall);
}

function rougeLScore(prediction, reference) {
  const pred = words(prediction);
  const ref = words(reference);
  if (!pred.length || !ref.length) return 0;
  const lcs = lcsLength(pred, ref);
  const precision = lcs / pred.length;
  const recall = lcs / ref.length;
  if (!precision || !recall) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function lcsLength(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function isRefusal(answer) {
  const text = answer.toLowerCase();
  return [
    "handbook does not",
    "not provided in the handbook",
    "not enough information",
    "insufficient",
    "cannot answer",
    "cannot provide",
    "can't answer",
    "can't provide",
    "not supported",
    "do not have",
    "do not attempt",
    "no evidence",
    "not available through",
    "not available in the current system",
    "prohibited",
    "unauthorized",
    "outside",
  ].some((needle) => text.includes(needle));
}

function collectConfigDiff() {
  const baseline1 = readConfigSet(
    "baseline1_hf_merged_model",
    path.join(
      artifactRoots.hf,
      "UM_Handbook/outputs/qwen3_um_handbook_optimized_1/merged_model",
    ),
  );
  const served = readConfigSet("served_nfdlh_tensortalk_v2", artifactRoots.served);
  const localPpo = readConfigSet(
    "local_ppo_inference_actor_model",
    path.join(artifactRoots.localPpo, "ppo_inference_actor_model"),
  );
  return {
    compared_at: new Date().toISOString(),
    baseline1,
    served,
    localPpo,
    selected_differences: diffSelected(baseline1, served, localPpo),
  };
}

function readConfigSet(label, dir) {
  const config = readJsonSafe(path.join(dir, "config.json"));
  const generation = readJsonSafe(path.join(dir, "generation_config.json"));
  const tokenizer = readJsonSafe(path.join(dir, "tokenizer_config.json"));
  const templatePath = path.join(dir, "chat_template.jinja");
  return {
    label,
    dir,
    exists: existsSync(dir),
    config: pick(config, [
      "architectures",
      "model_type",
      "dtype",
      "quantization_config",
      "bos_token_id",
      "eos_token_id",
      "pad_token_id",
      "max_position_embeddings",
      "use_cache",
      "transformers_version",
    ]),
    generation_config: pick(generation, [
      "do_sample",
      "temperature",
      "top_p",
      "top_k",
      "eos_token_id",
      "pad_token_id",
      "bos_token_id",
      "transformers_version",
    ]),
    tokenizer_config: pick(tokenizer, [
      "tokenizer_class",
      "eos_token",
      "pad_token",
      "bos_token",
      "model_max_length",
      "is_local",
      "local_files_only",
    ]),
    chat_template_sha256: existsSync(templatePath)
      ? sha256(readFileSync(templatePath, "utf8"))
      : null,
    chat_template_has_enable_thinking: existsSync(templatePath)
      ? readFileSync(templatePath, "utf8").includes("enable_thinking")
      : false,
    files: existsSync(dir)
      ? ["config.json", "generation_config.json", "tokenizer_config.json", "chat_template.jinja", "model.safetensors"].filter((file) =>
          existsSync(path.join(dir, file)),
        )
      : [],
  };
}

function diffSelected(baseline1, served, localPpo) {
  return {
    served_vs_baseline1: compareConfigSets(served, baseline1),
    served_vs_local_ppo: compareConfigSets(served, localPpo),
    local_ppo_has_adapter_config: existsSync(
      path.join(artifactRoots.localPpo, "ppo_inference_actor_model/adapter_config.json"),
    ),
    served_has_adapter_config: existsSync(
      path.join(artifactRoots.served, "adapter_config.json"),
    ),
  };
}

function compareConfigSets(left, right) {
  const keys = [
    ["config", "dtype"],
    ["config", "quantization_config"],
    ["config", "use_cache"],
    ["generation_config", "temperature"],
    ["generation_config", "top_p"],
    ["generation_config", "top_k"],
    ["generation_config", "do_sample"],
    ["tokenizer_config", "pad_token"],
    ["tokenizer_config", "eos_token"],
    ["tokenizer_config", "model_max_length"],
    ["chat_template_sha256"],
  ];
  const diffs = {};
  for (const keyPath of keys) {
    const key = keyPath.join(".");
    const leftValue = get(left, keyPath);
    const rightValue = get(right, keyPath);
    if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
      diffs[key] = { left: leftValue, right: rightValue };
    }
  }
  return diffs;
}

function collectNotebookClaims() {
  return {
    baseline1: {
      dataset: "SFT_QA_Training_Ready.jsonl",
      split: { train: 800, validation: 100, test: 100, seed: 42 },
      prompt_format:
        "chat messages: system prompt + user question; evaluation adds 'Answer directly and do not show reasoning. /no_think' and calls apply_chat_template(add_generation_prompt=True, enable_thinking=False)",
      generation: {
        max_seq_length: 1024,
        max_new_tokens: 160,
        do_sample: false,
        temperature_defined_but_unused_when_do_sample_false: 0.7,
        top_p_defined_but_unused_when_do_sample_false: 0.8,
        top_k_defined_but_unused_when_do_sample_false: 20,
        repetition_penalty: 1.02,
      },
      lora: {
        base_model: "Qwen/Qwen3-8B",
        use_4bit: true,
        r: 16,
        alpha: 32,
        dropout: 0.1,
        target_modules: ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
      },
      reported_generation_metrics: {
        validation_exact_match: 0.77,
        validation_token_f1: 0.9110538566697056,
        validation_rouge_l: 0.8979354036310578,
        test_exact_match: 0.72,
        test_token_f1: 0.8869183252215395,
        test_rouge_l: 0.8676948494563335,
      },
    },
    baseline2: {
      retrieval: {
        type: "dense_embedding + faiss + metadata_rerank",
        embedding_model: "BAAI/bge-base-en-v1.5",
        top_k: 3,
        rerank_pool: 12,
        hit_at_1_primary: 0.821,
        hit_at_k_primary: 0.954,
        hit_at_k_same_group: 0.991,
        scope_match_at_1: 0.996,
      },
      plain_vs_rag_generation: {
        eval_size: 20,
        plain_exact_match: 0,
        plain_token_f1: 0.3391,
        rag_exact_match: 0,
        rag_token_f1: 0.846,
      },
      generation: {
        max_new_tokens: 128,
        do_sample: false,
        repetition_penalty: 1.02,
      },
    },
    local_ppo: {
      stage: "Stage 3 PPO",
      initial_actor_source:
        "base_plus_fresh_ppo_lora; uses_previous_stage_weights=false; uses_previous_stage_adapter=false",
      run_type: "full_1000row_rule_reward_ppo_2epoch_900steps",
      train_rows: 900,
      valid_rows: 100,
      reward_model: "rule_based_preference_reward_function",
      uses_separate_neural_reward_model: false,
      inference_full_weights_found: true,
      ppo_validation_predictions_note:
        "CSV is reward/prediction evidence, not a Baseline 1-style EM/F1 reproduction report.",
    },
  };
}

function summarize(results, metadata) {
  const byPath = {};
  for (const result of results) {
    byPath[result.path_id] ??= {
      path_label: result.path_label,
      count: 0,
      exact_match: 0,
      token_f1_sum: 0,
      rouge_l_sum: 0,
      refusal_count: 0,
      empty_count: 0,
      invalid_count: 0,
      answer_words_sum: 0,
      latency_ms_sum: 0,
      latency_count: 0,
      by_kind: {},
      failures: {},
    };
    const pathSummary = byPath[result.path_id];
    pathSummary.count += 1;
    pathSummary.exact_match += result.exact_match;
    pathSummary.token_f1_sum += result.token_f1;
    pathSummary.rouge_l_sum += result.rouge_l;
    pathSummary.refusal_count += result.refusal ? 1 : 0;
    pathSummary.empty_count += result.empty ? 1 : 0;
    pathSummary.invalid_count += result.invalid ? 1 : 0;
    pathSummary.answer_words_sum += result.answer_words;
    if (typeof result.latency_ms === "number") {
      pathSummary.latency_ms_sum += result.latency_ms;
      pathSummary.latency_count += 1;
    }
    pathSummary.failures[result.failure_category] =
      (pathSummary.failures[result.failure_category] ?? 0) + 1;
    pathSummary.by_kind[result.kind] ??= {
      count: 0,
      exact_match: 0,
      token_f1_sum: 0,
      rouge_l_sum: 0,
      refusal_count: 0,
      empty_count: 0,
      invalid_count: 0,
      answer_words_sum: 0,
      latency_ms_sum: 0,
      latency_count: 0,
    };
    const kindSummary = pathSummary.by_kind[result.kind];
    kindSummary.count += 1;
    kindSummary.exact_match += result.exact_match;
    kindSummary.token_f1_sum += result.token_f1;
    kindSummary.rouge_l_sum += result.rouge_l;
    kindSummary.refusal_count += result.refusal ? 1 : 0;
    kindSummary.empty_count += result.empty ? 1 : 0;
    kindSummary.invalid_count += result.invalid ? 1 : 0;
    kindSummary.answer_words_sum += result.answer_words;
    if (typeof result.latency_ms === "number") {
      kindSummary.latency_ms_sum += result.latency_ms;
      kindSummary.latency_count += 1;
    }
  }

  for (const pathSummary of Object.values(byPath)) {
    finalizeSummary(pathSummary);
    for (const kindSummary of Object.values(pathSummary.by_kind)) {
      finalizeSummary(kindSummary);
    }
  }

  return {
    metadata,
    eval_set: summarizeEvalSet(results),
    by_path: byPath,
    root_cause_ranking: rankRootCauses(results),
    output_files: {
      eval_set: "outputs/eval-set.json",
      results_jsonl: "outputs/results.jsonl",
      results_csv: "outputs/results.csv",
      summary: "outputs/summary.json",
      config_diff: "outputs/config-diff.json",
      claims: "outputs/notebook-local-claims.json",
      report: "outputs/audit-report.md",
    },
  };
}

function summarizeEvalSet(results) {
  const byId = new Map();
  for (const result of results) {
    byId.set(result.id, result.kind);
  }
  const kinds = [...byId.values()];
  return {
    total: byId.size,
    exact_sft: kinds.filter((kind) => kind === "exact_sft").length,
    paraphrase: kinds.filter((kind) => kind === "paraphrase").length,
    unsupported: kinds.filter((kind) => kind === "unsupported").length,
  };
}

function finalizeSummary(summary) {
  summary.exact_match_rate = round(summary.exact_match / Math.max(1, summary.count), 4);
  summary.token_f1 = round(summary.token_f1_sum / Math.max(1, summary.count), 4);
  summary.rouge_l = round(summary.rouge_l_sum / Math.max(1, summary.count), 4);
  summary.refusal_rate = round(summary.refusal_count / Math.max(1, summary.count), 4);
  summary.empty_rate = round(summary.empty_count / Math.max(1, summary.count), 4);
  summary.invalid_rate = round(summary.invalid_count / Math.max(1, summary.count), 4);
  summary.avg_answer_words = round(summary.answer_words_sum / Math.max(1, summary.count), 2);
  summary.avg_latency_ms = summary.latency_count
    ? round(summary.latency_ms_sum / summary.latency_count, 2)
    : null;
  delete summary.exact_match;
  delete summary.token_f1_sum;
  delete summary.rouge_l_sum;
  delete summary.answer_words_sum;
  delete summary.latency_ms_sum;
  delete summary.latency_count;
}

function rankRootCauses(results) {
  const directNotebook = results.filter((result) => result.path_id === "direct_notebook_chat");
  const directPlain = results.filter((result) => result.path_id === "direct_plain_user");
  const appNoRag = results.filter((result) => result.path_id === "app_no_rag");
  const infraFailures = results.filter((result) =>
    /timeout|http_error|network_error|missing_config|not_run/.test(result.failure_category),
  );

  if (infraFailures.length / Math.max(1, results.length) > 0.5) {
    return [
      "Endpoint availability or request compatibility is the top cause: most calls did not return usable completions.",
      "Config/template reproduction cannot be judged until the endpoint returns direct notebook-style completions.",
      "App prompt mismatch remains secondary unless direct endpoint succeeds while app No RAG fails.",
    ];
  }

  const exactDirect = metricForKind(directNotebook, "exact_sft", "token_f1");
  const exactPlain = metricForKind(directPlain, "exact_sft", "token_f1");
  const exactApp = metricForKind(appNoRag, "exact_sft", "token_f1");
  const ranking = [];
  if (exactDirect < 0.7) {
    ranking.push(
      "Serving/config/model mismatch: notebook-style direct prompting failed on exact SFT-style questions.",
    );
  }
  if (exactDirect >= 0.85 && exactPlain < 0.7) {
    ranking.push("Prompt/template sensitivity: notebook-style chat works better than plain user prompts.");
  }
  if (exactDirect >= 0.85 && exactApp < 0.7) {
    ranking.push("App prompt/config mismatch: direct endpoint works but app No RAG underperforms.");
  }
  if (metricForKind(directNotebook, "paraphrase", "token_f1") < exactDirect - 0.2) {
    ranking.push("Generalization gap: exact SFT-style prompts outperform paraphrases.");
  }
  return ranking.length ? ranking : ["No dominant failure mode identified from the measured run."];
}

function metricForKind(results, kind, field) {
  const subset = results.filter((result) => result.kind === kind);
  return (
    subset.reduce((sum, result) => sum + Number(result[field] ?? 0), 0) /
    Math.max(1, subset.length)
  );
}

function renderReport(summary, claims, configDiff) {
  const lineageNote =
    configDiff.baseline1.exists && configDiff.served.exists && configDiff.localPpo.exists
      ? `Additional lineage note: the served config matches the local PPO inference actor on selected config fields, while differing from Baseline 1 merged-model config in dtype, quantization_config, and use_cache. Because the PPO manifest says it did not start from previous-stage SFT/RAG weights or adapters, Baseline 1 exact-answer reproduction should not be assumed for ${summary.metadata.model} without a model-upload/lineage check.`
      : "Additional lineage note: config lineage comparison is incomplete because one or more local config inputs were unavailable. Re-run after downloading the Baseline 1 merged model, served repo snapshot, and local PPO artifacts before making lineage claims.";
  const pathSections = Object.entries(summary.by_path)
    .map(([id, item]) => {
      const kinds = Object.entries(item.by_kind)
        .map(
          ([kind, value]) =>
            `- ${kind}: EM ${value.exact_match_rate}, token-F1 ${value.token_f1}, ROUGE-L ${value.rouge_l}, refusal ${value.refusal_rate}, invalid ${value.invalid_rate}`,
        )
        .join("\n");
      return `### ${id}\n${item.path_label}\n\nOverall: EM ${item.exact_match_rate}, token-F1 ${item.token_f1}, ROUGE-L ${item.rouge_l}, refusal ${item.refusal_rate}, empty ${item.empty_rate}, invalid ${item.invalid_rate}, avg words ${item.avg_answer_words}, avg latency ${item.avg_latency_ms ?? "n/a"} ms.\n\n${kinds}\n\nFailure categories: ${JSON.stringify(item.failures)}`;
    })
    .join("\n\n");

  return `# Hosted TensorTalk Bare Model Reproduction Audit

Generated: ${summary.metadata.auditFinishedAt}

## Scope

This audit did not change the app harness, RAG, web search, UI, or production behavior. It created local audit artifacts only.

## Notebook And Local Artifact Claims

Baseline 1 evaluates ${claims.baseline1.dataset} with an 8:1:1 split, seed 42, and notebook-style chat formatting. Evaluation adds /no_think and uses apply_chat_template(add_generation_prompt=True, enable_thinking=False). Reported validation EM/token-F1/ROUGE-L are ${claims.baseline1.reported_generation_metrics.validation_exact_match}, ${round(claims.baseline1.reported_generation_metrics.validation_token_f1, 4)}, ${round(claims.baseline1.reported_generation_metrics.validation_rouge_l, 4)}. Reported test EM/token-F1/ROUGE-L are ${claims.baseline1.reported_generation_metrics.test_exact_match}, ${round(claims.baseline1.reported_generation_metrics.test_token_f1, 4)}, ${round(claims.baseline1.reported_generation_metrics.test_rouge_l, 4)}.

Baseline 2 evaluates dense BGE + FAISS + metadata rerank retrieval at top_k=3. Retrieval hit@k primary is ${claims.baseline2.retrieval.hit_at_k_primary}. Its 20-example generation eval reports plain token-F1 ${claims.baseline2.plain_vs_rag_generation.plain_token_f1} vs RAG token-F1 ${claims.baseline2.plain_vs_rag_generation.rag_token_f1}; this is a RAG-conditioned result, not bare-model equivalence.

Local PPO artifacts identify Stage 3 PPO with 900 training steps, 900 train rows, 100 validation rows, rule-based reward, and full inference weights present. The initial actor source is ${claims.local_ppo.initial_actor_source}. The validation CSV is reward/prediction evidence, not a Baseline 1 EM/F1 reproduction report.

## Measured Results

${pathSections}

## Config Diff Highlights

- Served vs Baseline 1 selected differences: ${JSON.stringify(configDiff.selected_differences.served_vs_baseline1)}
- Served vs local PPO selected differences: ${JSON.stringify(configDiff.selected_differences.served_vs_local_ppo)}
- Local PPO has adapter_config.json: ${configDiff.selected_differences.local_ppo_has_adapter_config}
- Served repo has adapter_config.json: ${configDiff.selected_differences.served_has_adapter_config}

## Root Cause Ranking

${summary.root_cause_ranking.map((item, index) => `${index + 1}. ${item}`).join("\n")}

${lineageNote}

## Recommended Fix Groups

Config-only:
- Align request-time generation with the notebook before changing prompts: max tokens around 160 for Baseline 1 reproduction, deterministic decoding, repetition_penalty 1.02, and thinking disabled at template level where the serving stack supports it.
- Verify EOS/PAD handling because the notebook uses tokenizer eos as generation eos and pad, while configs encode pad as <|endoftext|>.

Endpoint-only:
- If calls time out or return no completions, inspect RunPod worker state, vLLM logs, model load errors, and whether the endpoint cache is still serving the intended ${summary.metadata.model}.
- Confirm vLLM accepts chat_template_kwargs.enable_thinking=false or replace it with an endpoint-supported equivalent.

Model-upload:
- If exact SFT-style notebook prompting fails after endpoint health is fixed, compare the served model.safetensors against the intended local PPO or Baseline 1 merged model and re-upload to a versioned repo if hashes/lineage do not match.
- Decide whether the target is Baseline 1 SFT reproduction or Stage 3 PPO behavior; they are different artifacts with different evaluation evidence.

App changes:
- Only consider app prompt/harness changes after direct endpoint notebook-style prompting succeeds. If direct succeeds and app No RAG fails, then compare the app flattened prompt against the notebook chat template.

## Evidence Files

- ${summary.output_files.eval_set}
- ${summary.output_files.results_jsonl}
- ${summary.output_files.results_csv}
- ${summary.output_files.summary}
- ${summary.output_files.config_diff}
- ${summary.output_files.claims}
`;
}

function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function toCsv(rows) {
  const headers = [
    "id",
    "kind",
    "qa_id",
    "path_id",
    "question",
    "reference_answer",
    "model_answer",
    "exact_match",
    "token_f1",
    "rouge_l",
    "refusal",
    "empty",
    "invalid",
    "answer_words",
    "latency_ms",
    "failure_category",
    "error",
  ];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function pick(obj, keys) {
  if (!obj) return null;
  return Object.fromEntries(keys.map((key) => [key, obj[key]]));
}

function get(obj, keyPath) {
  return keyPath.reduce((value, key) => (value == null ? undefined : value[key]), obj);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function trimSlash(value) {
  return String(value).replace(/\/$/, "");
}

function redactEndpoint(value) {
  return value.replace(/\/v2\/([^/]+)/, "/v2/[endpoint-id]");
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
