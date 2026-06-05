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
- Calls `MODEL_API_URL` when configured, or returns a local evidence-based fallback.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Connect a model endpoint

Create `.env.local`:

```bash
MODEL_API_URL=https://your-model-endpoint.example
MODEL_API_KEY=your_token
```

The current API route sends a Hugging Face-style payload:

```json
{
  "inputs": "prompt text",
  "parameters": {
    "max_new_tokens": 512,
    "temperature": 0.2,
    "return_full_text": false
  }
}
```

For Vercel, add the same variables in Project Settings, then redeploy.
