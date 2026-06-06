# TensorTalk model infrastructure

This document records how TensorTalk connects the web app to the fine-tuned model.

## Current setup

The app uses three layers:

1. Hugging Face Hub stores the model files.
2. RunPod Serverless runs the model with vLLM.
3. Vercel hosts the Next.js frontend/API and calls RunPod through the Vercel AI SDK.

The current production values are:

```text
Hugging Face model: nfdlh/tensortalk
RunPod endpoint id: 2y1ra2h7x2bzii
RunPod OpenAI-compatible base URL: https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
Vercel production alias: https://tensor-talk.vercel.app
```

Do not commit API keys. Local secrets live in `.env.local`. Vercel secrets live in Vercel Project Settings or `vercel env`.

## App contract

The Next.js API route is:

```text
app/api/chat/route.ts
```

It retrieves handbook evidence locally, builds a prompt, and calls the model through `@ai-sdk/openai-compatible`.

Required environment variables:

```text
TENSORTALK_MODEL=nfdlh/tensortalk
TENSORTALK_API_BASE_URL=https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
TENSORTALK_API_KEY=<RunPod API key>
```

The app no longer uses OpenRouter or a local answer fallback. If RunPod is unavailable or `TENSORTALK_API_BASE_URL` is missing, `/api/chat` returns an error instead of generating a fallback answer.

## Verification commands

Local API check:

```bash
curl -sS -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"What are the faculty objectives?"}' | python -m json.tool
```

Production API check:

```bash
curl -sS -X POST https://tensor-talk.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"What are the faculty objectives?"}' | python -m json.tool
```

Expected response shape:

```text
answer: present
evidence: array with retrieved handbook chunks
mode: tensortalk-endpoint:nfdlh/tensortalk
```

The answer should not include `<think>` blocks. The API route strips those before returning text to the frontend.

