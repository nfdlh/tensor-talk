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
OPENROUTER_API_KEY
OPENROUTER_EMBEDDING_MODEL
```

Semantic vector mode reads OpenRouter for embeddings and the TensorTalk endpoint
for generation. Lexical mode reads MiniSearch for retrieval and uses the same
TensorTalk endpoint for generation.

Check Vercel env vars:

```bash
vercel env ls
```

Set or update production variables:

```bash
vercel env add TENSORTALK_MODEL production --force
vercel env add TENSORTALK_API_BASE_URL production --force
vercel env add TENSORTALK_API_KEY production --force
vercel env add OPENROUTER_API_KEY production --force
vercel env add OPENROUTER_EMBEDDING_MODEL production --force
```

Use the RunPod API key for `TENSORTALK_API_KEY`.
Use the OpenRouter key for `OPENROUTER_API_KEY`.

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

Expected:

```text
mode: tensortalk-endpoint:nfdlh/tensortalk-v2
retrievalMode: semantic
answer: present
evidence: present
```

To test lexical retrieval, add `"retrievalMode":"lexical"` to the request body.
If a response says `OPENROUTER_API_KEY is required` or
`TENSORTALK_API_BASE_URL is required`, the matching Vercel production env is
missing or the deployment was built before the env was added.
