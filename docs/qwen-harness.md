# Qwen harness

This document explains the `Route -> Harness` selector in the TensorTalk UI.

## Short version

The harness model is not the final chat model.

Final answer generation always uses:

```text
TENSORTALK_MODEL -> RunPod OpenAI-compatible endpoint -> nfdlh/tensortalk-v2
```

The harness selector only changes the model used for helper calls around the
answer:

1. Route planning for Web Auto.
2. One-pass repair when grounding finds unsupported exact facts.

The default harness is TensorTalk. The optional OpenRouter harness is Qwen.

## UI choices

The UI exposes two harness choices inside the Route combobox:

```text
TensorTalk
OpenRouter Qwen
```

`TensorTalk` means planner and repair calls use the same hosted RunPod
fine-tuned model as the final answer model.

`OpenRouter Qwen` means planner and repair calls use:

```text
OPENROUTER_HARNESS_MODEL=qwen/qwen3-8b
```

The final answer still uses `TENSORTALK_MODEL` through `TENSORTALK_API_BASE_URL`.

## What Qwen does

When selected, OpenRouter Qwen can run these helper calls:

| Step | When it runs | Model used when Harness = OpenRouter Qwen |
| --- | --- | --- |
| Planner | Web Auto after local retrieval | `OPENROUTER_HARNESS_MODEL` |
| Repair | Grounding failed and accepted evidence exists | `OPENROUTER_HARNESS_MODEL` |

The planner returns JSON with:

```text
needWeb
queryType
answerFocus
targetKeywords
searchQueries
reason
```

TensorTalk then applies deterministic web guards. If the question needs current
or official web evidence, the guard can force web search even if the hosted
planner says no.

The repair call rewrites one draft answer against accepted evidence only. The
deterministic grounding judge decides whether the repaired answer is better
before keeping it.

## What Qwen does not do

OpenRouter Qwen does not:

1. Generate the final user-facing answer.
2. Replace the fine-tuned TensorTalk model.
3. Replace local semantic retrieval.
4. Create embeddings.
5. Rerank local handbook chunks.
6. Judge grounding.
7. Search the web directly.

Semantic retrieval uses OpenRouter embeddings separately:

```text
OPENROUTER_EMBEDDING_MODEL=baai/bge-base-en-v1.5
```

That embedding model is independent from `OPENROUTER_HARNESS_MODEL`.

## Route behavior

Harness usage depends on the route:

| Route setting | Harness planner? | Harness repair? |
| --- | --- | --- |
| Web Auto | Yes, after local retrieval | Yes, only if grounding fails |
| Web On | No, web search is forced deterministically | Yes, only if grounding fails |
| Web Off | No web planner | Yes, only if grounding fails |
| No RAG + Web Off | No, model-only route | No accepted evidence, so no repair |

If the selected harness call fails during planning, TensorTalk falls back to the
deterministic planner unless the failure is a missing harness configuration. If
repair fails, TensorTalk keeps the original answer unless the failure is a
missing harness configuration.

## Environment variables

Required for OpenRouter Qwen harness:

```text
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HARNESS_MODEL=qwen/qwen3-8b
```

The app default for `OPENROUTER_HARNESS_MODEL` is `qwen/qwen3-8b`.

Required for the final answer model:

```text
TENSORTALK_MODEL=nfdlh/tensortalk-v2
TENSORTALK_API_BASE_URL=https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
TENSORTALK_API_KEY=
```

`TENSORTALK_API_KEY` should be the RunPod API key for the configured endpoint.

## How to verify

Use the API with OpenRouter Qwen selected:

```bash
curl -sS -N -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  --data '{
    "message":"What are the latest FSKTM admission contacts?",
    "retrievalMode":"semantic",
    "webMode":"auto",
    "harnessMode":"openrouter",
    "thinkingMode":"limited"
  }' \
  > /tmp/tensortalk-openrouter-harness.ndjson
```

Then inspect the metadata and final response:

```bash
node - <<'NODE'
const fs = require("fs");
const events = fs.readFileSync("/tmp/tensortalk-openrouter-harness.ndjson", "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
console.log(events.find((event) => event.type === "metadata"));
console.log(events.find((event) => event.type === "done")?.response);
NODE
```

Expected signals:

```text
metadata.harnessMode: openrouter
metadata.models includes role: harness, name: qwen/qwen3-8b
metadata.models includes role: chat, name: nfdlh/tensortalk-v2
done.response.mode: tensortalk-endpoint:nfdlh/tensortalk-v2
done.response.trace.planner.source: openrouter, when Web Auto planner ran
```

Those signals prove OpenRouter Qwen handled the harness path while the final
answer still came from the hosted TensorTalk model.
