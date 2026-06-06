# TensorTalk Student Handbook

Next.js 16 web app for the UM FSKTM handbook assistant.

The app uses:

- pnpm
- Tailwind CSS v4
- shadcn/ui
- TanStack Query
- ky
- next-themes
- Vercel AI SDK with an OpenAI-compatible TensorTalk model endpoint

The assistant does three things:

- Loads `data/UM_RAG_Knowledge_Base.jsonl` from the TensorTalk Hugging Face repo.
- Searches the handbook locally in the Next.js API route with MiniSearch.
- Calls the fine-tuned `nfdlh/tensortalk` model through an OpenAI-compatible
  inference endpoint using the Vercel AI SDK.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Connect TensorTalk Model

Create `.env.local`:

```bash
TENSORTALK_MODEL=nfdlh/tensortalk
TENSORTALK_API_BASE_URL=https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
TENSORTALK_API_KEY=your_endpoint_key
```

`TENSORTALK_MODEL` is optional. If it is omitted, the API route uses
`nfdlh/tensortalk` as the default fine-tuned model.

`TENSORTALK_API_BASE_URL` must point to a running OpenAI-compatible model
server, such as a Hugging Face Inference Endpoint, RunPod/vLLM endpoint, or
Modal/vLLM endpoint serving the uploaded `nfdlh/tensortalk` weights.

The current RunPod Serverless endpoint created for this project is
`2y1ra2h7x2bzii`. It uses the OpenAI-compatible vLLM URL:

```bash
https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
```

Use the RunPod API key as `TENSORTALK_API_KEY`.

For Vercel, add the same variables in Project Settings, then redeploy. Without
`TENSORTALK_API_BASE_URL`, TensorTalk returns a configuration error instead of
using a fallback model.
