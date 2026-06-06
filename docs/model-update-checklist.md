# Model update checklist

Use this checklist when replacing or updating the TensorTalk model.

## 1. Prepare model files

Confirm the model is a merged/full model, not just a LoRA adapter.

Required files:

```text
model.safetensors
config.json
generation_config.json
tokenizer.json
tokenizer_config.json
chat_template.jinja
```

Sharded models are fine if the repo includes all shard files and `model.safetensors.index.json`.

## 2. Upload to Hugging Face

Use a versioned repo when possible. The current production repo is
`nfdlh/tensortalk-v2`; use the next version for a future replacement.

```bash
hf upload-large-folder nfdlh/tensortalk-v3 /path/to/merged_model --repo-type model
```

Verify:

```bash
hf download nfdlh/tensortalk-v3 model.safetensors --dry-run
```

## 3. Update RunPod

Update or recreate the RunPod vLLM endpoint so it loads the new repo:

```text
MODEL_NAME=nfdlh/tensortalk-v3
OPENAI_SERVED_MODEL_NAME_OVERRIDE=nfdlh/tensortalk-v3
```

If using the same endpoint id, the base URL stays:

```text
https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
```

If using a new endpoint, copy the new `/openai/v1` URL.

## 4. Update Vercel env

For a new model repo on the same RunPod endpoint:

```bash
vercel env add TENSORTALK_MODEL production --force
```

For a new RunPod endpoint:

```bash
vercel env add TENSORTALK_API_BASE_URL production --force
vercel env add TENSORTALK_API_KEY production --force
```

## 5. Deploy

```bash
vercel --prod --yes
```

## 6. Verify

Check production:

```bash
curl -sS -X POST https://tensor-talk.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"What are the faculty objectives?"}' | python -m json.tool
```

Expected:

```text
mode: tensortalk-endpoint:<new-model-name>
answer: present
evidence: present
```

Also check that the answer does not contain raw `<think>` blocks.
