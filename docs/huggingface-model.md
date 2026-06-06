# Hugging Face model repo

The current fine-tuned model is uploaded to:

```text
https://huggingface.co/nfdlh/tensortalk
```

## Required files

For RunPod/vLLM, the Hugging Face repo must contain the full merged model, not only LoRA adapter weights.

Required files:

```text
model.safetensors
config.json
generation_config.json
tokenizer.json
tokenizer_config.json
chat_template.jinja
```

If the model is sharded, the weight files may look like this instead:

```text
model-00001-of-00004.safetensors
model-00002-of-00004.safetensors
model-00003-of-00004.safetensors
model-00004-of-00004.safetensors
model.safetensors.index.json
```

Do not upload only:

```text
adapter_model.safetensors
```

That is a LoRA adapter. The current RunPod endpoint expects a complete merged model repo.

## Uploading a replacement model

Recommended path:

1. Create a new versioned Hugging Face model repo, for example:

```text
nfdlh/tensortalk-v2
```

2. Upload the complete merged model folder:

```bash
hf upload-large-folder nfdlh/tensortalk-v2 /path/to/merged_model --repo-type model
```

3. Verify remote files:

```bash
hf download nfdlh/tensortalk-v2 model.safetensors --dry-run
```

If the model is sharded, dry-run one of the shard files or inspect the repo file list on Hugging Face.

## Replacing the existing repo

You can overwrite `nfdlh/tensortalk`, but versioned repos are safer. Reusing the same repo name makes it harder to know which model RunPod has cached.

If you do overwrite `nfdlh/tensortalk`, restart or recreate the RunPod endpoint so vLLM does not keep serving an older cached copy.

