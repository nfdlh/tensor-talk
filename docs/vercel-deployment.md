# Vercel deployment

Vercel hosts the TensorTalk frontend and `/api/chat` route.

## Project

```text
Project name: tensor-talk
Production URL: https://tensor-talk.vercel.app
```

The local repo is linked through `.vercel/project.json`.

## Production environment variables

Production variables:

```text
TENSORTALK_MODEL
TENSORTALK_API_BASE_URL
TENSORTALK_API_KEY
TENSORTALK_MAX_OUTPUT_TOKENS
TENSORTALK_MAX_THINKING_TOKENS
OPENROUTER_API_KEY
OPENROUTER_BASE_URL
OPENROUTER_EMBEDDING_MODEL
OPENROUTER_HARNESS_MODEL
EXA_API_KEY
THREAD_TITLE_MODEL
```

Semantic vector mode reads OpenRouter for embeddings and the TensorTalk endpoint
for generation. Lexical mode reads MiniSearch for retrieval and uses the same
TensorTalk endpoint for generation.
The OpenRouter Qwen harness is used only when the UI harness selector is set to
OpenRouter Qwen. It affects route planning and one-pass repair, not final answer
generation. See `docs/qwen-harness.md`.
Official web search reads Exa only when Web On is selected or Web Auto decides
official web evidence is required. Thread titles use OpenRouter when available
and fall back to a trimmed question when unavailable.

Check Vercel env vars:

```bash
vercel env ls
```

Set or update production variables:

```bash
vercel env add TENSORTALK_MODEL production --force
vercel env add TENSORTALK_API_BASE_URL production --force
vercel env add TENSORTALK_API_KEY production --force
vercel env add TENSORTALK_MAX_OUTPUT_TOKENS production --force
vercel env add TENSORTALK_MAX_THINKING_TOKENS production --force
vercel env add OPENROUTER_API_KEY production --force
vercel env add OPENROUTER_BASE_URL production --force
vercel env add OPENROUTER_EMBEDDING_MODEL production --force
vercel env add OPENROUTER_HARNESS_MODEL production --force
vercel env add EXA_API_KEY production --force
vercel env add THREAD_TITLE_MODEL production --force
```

Use the RunPod API key for `TENSORTALK_API_KEY`.
Use the OpenRouter key for `OPENROUTER_API_KEY`.
Use the Exa key for `EXA_API_KEY`.

## Deploy

Deploy production:

```bash
vercel --prod --yes
```

Inspect the production deployment:

```bash
vercel inspect tensor-talk.vercel.app
```

## Production verification

After deploying, run:

```bash
curl -sS -N -X POST https://tensor-talk.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"What are the faculty objectives?","retrievalMode":"semantic","webMode":"off"}' \
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

Expected:

```text
mode: tensortalk-endpoint:nfdlh/tensortalk-v2
retrievalMode: semantic
webMode: off
answer: present
evidence: present
```

Test the other routes by changing the request body:

```text
No RAG + Web Off: {"message":"What is FSKTM?","retrievalMode":"none","webMode":"off"}
No RAG + Web On: {"message":"kat mana parking?","retrievalMode":"none","webMode":"on"}
Lexical + Web Auto: {"message":"What is industrial training?","retrievalMode":"lexical","webMode":"auto"}
```

If a response says `OPENROUTER_API_KEY is required`,
`TENSORTALK_API_BASE_URL is required`, or `EXA_API_KEY is required`, the
matching Vercel production env is missing or the deployment was built before
the env was added.
