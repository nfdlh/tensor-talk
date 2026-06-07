# TensorTalk model infrastructure

This document records how TensorTalk connects the web app to the fine-tuned model.

## Setup

The app supports two retrieval modes:

1. Semantic vectors, the default chat UI mode.
2. Lexical MiniSearch, the local retriever.

Both modes use the same hosted TensorTalk generation path:

1. Hugging Face Hub stores the model files.
2. RunPod Serverless runs the model with vLLM.
3. Vercel hosts the Next.js frontend/API and calls RunPod through the Vercel AI SDK.

Semantic retrieval adds:

1. OpenRouter embeddings with `baai/bge-base-en-v1.5`.
2. `data/UM_RAG_Vectors.sqlite` for normalized handbook vectors.
3. The same hosted `nfdlh/tensortalk-v2` endpoint for answer generation.

Configured values:

```text
Hugging Face model: nfdlh/tensortalk-v2
RunPod endpoint id: 2y1ra2h7x2bzii
RunPod OpenAI-compatible base URL: https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
Vercel production alias: https://tensor-talk.vercel.app
```

Do not commit API keys. Local secrets live in `.env.local`. Vercel secrets live
in Vercel Project Settings or `vercel env`.

For the request-by-request app flow, see `docs/architecture.md`.

## App contract

The Next.js API route is:

```text
app/api/chat/route.ts
```

It retrieves handbook evidence locally, builds a prompt, and calls the model through `@ai-sdk/openai-compatible`.

Environment variables:

```text
TENSORTALK_MODEL=nfdlh/tensortalk-v2
TENSORTALK_API_BASE_URL=https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
TENSORTALK_API_KEY=<RunPod API key>
TENSORTALK_MAX_OUTPUT_TOKENS=640
TENSORTALK_MAX_THINKING_TOKENS=180

OPENROUTER_API_KEY=<OpenRouter API key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_EMBEDDING_MODEL=baai/bge-base-en-v1.5
OPENROUTER_HARNESS_MODEL=qwen/qwen3-8b
```

Run `pnpm rag:index` after setting `OPENROUTER_API_KEY` to create the SQLite
vector store used by semantic mode.

The harness selector uses the hosted TensorTalk model by default. Selecting
OpenRouter Qwen changes planner and repair harness calls only; final answer
generation remains `TENSORTALK_MODEL` through the RunPod endpoint.

For the exact Qwen harness contract, including what it does and does not
replace, see `docs/qwen-harness.md`.

If the hosted model endpoint is unavailable, `/api/chat` returns an error
instead of generating an evidence-only local answer.

## Verification commands

Local API check:

```bash
curl -sS -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"What are the faculty objectives?"}' \
  > /tmp/tensortalk-local.ndjson

node - <<'NODE'
const fs = require("fs");
const events = fs.readFileSync("/tmp/tensortalk-local.ndjson", "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
console.log(events.find((event) => event.type === "done")?.response);
NODE
```

Production API check:

```bash
curl -sS -N -X POST https://tensor-talk.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"What are the faculty objectives?"}' \
  > /tmp/tensortalk-production.ndjson

node - <<'NODE'
const fs = require("fs");
const events = fs.readFileSync("/tmp/tensortalk-production.ndjson", "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
console.log(events.find((event) => event.type === "done")?.response);
NODE
```

Expected response shape:

```text
answer: present
evidence: array with retrieved handbook chunks
mode: tensortalk-endpoint:nfdlh/tensortalk-v2
retrievalMode: semantic or lexical
```

The answer should not include raw `<think>` tags. The API route separates
thinking text into an optional `thinking` field so the frontend can show it in a
collapsible block.
