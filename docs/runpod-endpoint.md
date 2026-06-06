# RunPod vLLM endpoint

RunPod serves the Hugging Face model through an OpenAI-compatible vLLM endpoint.

## Configured endpoint

```text
Endpoint name: tensortalk-vllm
Endpoint id: 2y1ra2h7x2bzii
OpenAI-compatible URL: https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1
Model served: nfdlh/tensortalk-v2
Workers min: 0
Workers max: 2
GPU candidates: NVIDIA RTX A5000, NVIDIA L4, NVIDIA GeForce RTX 3090
Endpoint version: 2
```

`workersMin=0` keeps cost lower because the endpoint scales to zero when idle.
First requests may be slow because RunPod has to start a worker and load the
model.

## Configured template

The endpoint was created from the official RunPod vLLM worker image:

```text
runpod/worker-v1-vllm:v2.20.0
```

Important template environment variables:

```text
MODEL_NAME=nfdlh/tensortalk-v2
OPENAI_SERVED_MODEL_NAME_OVERRIDE=nfdlh/tensortalk-v2
MAX_MODEL_LEN=4096
MAX_NUM_SEQS=1
GPU_MEMORY_UTILIZATION=0.90
DTYPE=bfloat16
TRUST_REMOTE_CODE=true
```

## Direct model test

Use the RunPod API key as the bearer token:

```bash
curl -sS https://api.runpod.ai/v2/2y1ra2h7x2bzii/openai/v1/chat/completions \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "model": "nfdlh/tensortalk-v2",
    "messages": [
      {
        "role": "user",
        "content": "Say hello as TensorTalk in one short sentence."
      }
    ],
    "temperature": 0.2,
    "max_tokens": 64
  }'
```

## Updating the served model

Preferred update path:

1. Upload the new merged model to a versioned Hugging Face repo, for example `nfdlh/tensortalk-v3`.
2. Update or recreate the RunPod template with:

```text
MODEL_NAME=nfdlh/tensortalk-v3
OPENAI_SERVED_MODEL_NAME_OVERRIDE=nfdlh/tensortalk-v3
```

3. Update Vercel:

```text
TENSORTALK_MODEL=nfdlh/tensortalk-v3
```

The `TENSORTALK_API_BASE_URL` can stay the same if the same RunPod endpoint is
updated. If a new RunPod endpoint is created, update `TENSORTALK_API_BASE_URL`
too.

## Troubleshooting

If the dashboard says all workers are busy, check whether there are multiple
test requests in progress. The configured endpoint has `workersMax=2` to allow
two concurrent workers while keeping cost controlled.

If requests sit in queue for a long time, RunPod may be waiting for one of the
selected GPU types. You can add more GPU types or temporarily increase
`workersMax`.

If vLLM fails to load the model, the usual causes are:

- the Hugging Face repo has only LoRA adapter weights
- missing tokenizer/config files
- the model does not fit the selected GPU memory
- the model name in RunPod does not match the model requested by Vercel
