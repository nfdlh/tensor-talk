# TensorTalk Student Handbook

Next.js 16 web app for the UM FSKTM handbook assistant.

![TensorTalk architecture](public/tensortalk-architecture.png)

The current production app uses:

- pnpm
- Tailwind CSS v4
- shadcn/ui
- TanStack Query
- ky
- next-themes
- Vercel AI SDK with an OpenAI-compatible RunPod/vLLM endpoint

## How it works

TensorTalk is a retrieval-first handbook assistant. The browser never calls the
model directly. It sends each question to the Next.js API route, which selects
handbook evidence, adds that evidence to the prompt, and calls the hosted
fine-tuned model.

```mermaid
flowchart LR
  User["Student browser"]
  UI["TensorTalk chat UI<br/>components/tensor-talk-client.tsx"]
  API["POST /api/chat<br/>app/api/chat/route.ts"]
  RAG["MiniSearch retriever<br/>lib/rag.ts"]
  KB["UM handbook JSONL<br/>data/UM_RAG_Knowledge_Base.jsonl"]
  Prompt["Prompt with top 4 evidence chunks"]
  Model["RunPod vLLM endpoint<br/>nfdlh/tensortalk"]
  Response["Answer + evidence + mode"]

  User --> UI --> API
  API --> RAG
  RAG --> KB
  RAG --> Prompt
  API --> Prompt --> Model --> API
  API --> Response --> UI --> User
```

The request flow is:

1. Search `data/UM_RAG_Knowledge_Base.jsonl` locally with MiniSearch.
2. Keep the top 4 relevant handbook chunks as evidence.
3. Add the retrieved handbook evidence to the prompt.
4. Call the fine-tuned `nfdlh/tensortalk` model on RunPod through
   `@ai-sdk/openai-compatible`.
5. Return `{ answer, evidence, mode }` to the UI. The latest answer appears in
   the conversation, and its evidence appears in the right panel.

There is no OpenRouter path and no local answer fallback. If the RunPod endpoint
is unavailable, `/api/chat` returns an error instead of generating a fallback
answer.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Connect TensorTalk model

Create `.env.local`:

```bash
TENSORTALK_MODEL=nfdlh/tensortalk
TENSORTALK_API_BASE_URL=https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
TENSORTALK_API_KEY=your_runpod_api_key
```

`TENSORTALK_API_KEY` is the RunPod API key. Do not commit `.env.local`.

`TENSORTALK_MODEL` defaults to `nfdlh/tensortalk` in code, but keep it explicit
in env so the served model name, RunPod template, and Vercel config stay aligned.

The current RunPod Serverless endpoint is `2y1ra2h7x2bzii`. It serves
`nfdlh/tensortalk` through vLLM's OpenAI-compatible API:

```bash
https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
```

For Vercel production, the same three variables must exist in Project Settings.
After changing them, redeploy with `vercel --prod --yes`.

## Infrastructure docs

See `docs/` for the model hosting and deployment notes:

- `docs/architecture.md`
- `docs/model-infrastructure.md`
- `docs/huggingface-model.md`
- `docs/runpod-endpoint.md`
- `docs/vercel-deployment.md`
- `docs/model-update-checklist.md`
