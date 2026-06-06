# TensorTalk Student Handbook

Next.js 16 web app for the UM FSKTM handbook assistant.

The app uses:

- pnpm
- Tailwind CSS v4
- shadcn/ui
- TanStack Query
- ky
- next-themes

The assistant does three things:

- Loads `data/UM_RAG_Knowledge_Base.jsonl` from the TensorTalk Hugging Face repo.
- Searches the handbook locally in the Next.js API route with MiniSearch.
- Calls OpenRouter through the Vercel AI SDK when configured, or returns a
  local evidence-based fallback.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Connect OpenRouter

Create `.env.local`:

```bash
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=google/gemini-3.1-flash-lite
```

`OPENROUTER_MODEL` is optional. If it is omitted, the API route uses
`google/gemini-3.1-flash-lite` as the default chat model.

For Vercel, add the same variables in Project Settings, then redeploy. Without
`OPENROUTER_API_KEY`, TensorTalk still answers from the local handbook evidence
fallback.
