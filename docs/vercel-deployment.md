# Vercel deployment

Vercel hosts the TensorTalk frontend and `/api/chat` route.

## Project

```text
Project name: tensor-talk
Production URL: https://tensor-talk.vercel.app
```

The local repo is linked through `.vercel/project.json`.

## Production environment variables

Current production variables:

```text
TENSORTALK_MODEL
TENSORTALK_API_BASE_URL
TENSORTALK_API_KEY
```

The old OpenRouter variables were removed from Vercel because the app no longer reads them.

Check Vercel env vars:

```bash
vercel env ls
```

Set or update production variables:

```bash
vercel env add TENSORTALK_MODEL production --force
vercel env add TENSORTALK_API_BASE_URL production --force
vercel env add TENSORTALK_API_KEY production --force
```

Use the RunPod API key for `TENSORTALK_API_KEY`.

## Deploy

Deploy production:

```bash
vercel --prod --yes
```

Inspect the current production deployment:

```bash
vercel inspect tensor-talk.vercel.app
```

## Production verification

After deploying, run:

```bash
curl -sS -X POST https://tensor-talk.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"What are the faculty objectives?"}' | python -m json.tool
```

Expected:

```text
mode: tensortalk-endpoint:nfdlh/tensortalk
answer: present
evidence: present
```

If the response says `TENSORTALK_API_BASE_URL is required`, the Vercel production env is missing or the deployment was built before the env was added.

