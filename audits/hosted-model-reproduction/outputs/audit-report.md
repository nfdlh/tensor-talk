# Hosted TensorTalk Bare Model Reproduction Audit

Generated: 2026-06-07T01:56:16.157Z

## Scope

This audit did not change the app harness, RAG, web search, UI, or production behavior. It created local audit artifacts only.

## Notebook And Local Artifact Claims

Baseline 1 evaluates SFT_QA_Training_Ready.jsonl with an 8:1:1 split, seed 42, and notebook-style chat formatting. Evaluation adds /no_think and uses apply_chat_template(add_generation_prompt=True, enable_thinking=False). Reported validation EM/token-F1/ROUGE-L are 0.77, 0.9111, 0.8979. Reported test EM/token-F1/ROUGE-L are 0.72, 0.8869, 0.8677.

Baseline 2 evaluates dense BGE + FAISS + metadata rerank retrieval at top_k=3. Retrieval hit@k primary is 0.954. Its 20-example generation eval reports plain token-F1 0.3391 vs RAG token-F1 0.846; this is a RAG-conditioned result, not bare-model equivalence.

Local PPO artifacts identify Stage 3 PPO with 900 training steps, 900 train rows, 100 validation rows, rule-based reward, and full inference weights present. The initial actor source is base_plus_fresh_ppo_lora; uses_previous_stage_weights=false; uses_previous_stage_adapter=false. The validation CSV is reward/prediction evidence, not a Baseline 1 EM/F1 reproduction report.

## Measured Results

### direct_notebook_chat
Direct endpoint, notebook-style chat prompt

Overall: EM 0, token-F1 0.2808, ROUGE-L 0.1965, refusal 0.0833, empty 0, invalid 0, avg words 57.33, avg latency 1956.72 ms.

- exact_sft: EM 0, token-F1 0.3306, ROUGE-L 0.2269, refusal 0, invalid 0
- paraphrase: EM 0, token-F1 0.3433, ROUGE-L 0.2446, refusal 0, invalid 0
- unsupported: EM 0, token-F1 0, ROUGE-L 0, refusal 0.5, invalid 0

Failure categories: {"fail_low_f1":48,"partial_low_f1":2,"unsupported_answered":5,"unsupported_refusal":5}

### direct_plain_user
Direct endpoint, plain user prompt

Overall: EM 0, token-F1 0, ROUGE-L 0, refusal 0, empty 0.9667, invalid 0.9667, avg words 1.08, avg latency 3281.57 ms.

- exact_sft: EM 0, token-F1 0, ROUGE-L 0, refusal 0, invalid 1
- paraphrase: EM 0, token-F1 0, ROUGE-L 0, refusal 0, invalid 1
- unsupported: EM 0, token-F1 0, ROUGE-L 0, refusal 0, invalid 0.8

Failure categories: {"empty_answer":58,"unsupported_answered":2}

### app_no_rag
App /api/chat retrievalMode="none", webMode="off"

Overall: EM 0, token-F1 0.223, ROUGE-L 0.1608, refusal 0.2333, empty 0, invalid 0, avg words 48.37, avg latency 4538.7 ms.

- exact_sft: EM 0, token-F1 0.2621, ROUGE-L 0.1917, refusal 0.2, invalid 0
- paraphrase: EM 0, token-F1 0.2732, ROUGE-L 0.1942, refusal 0.04, invalid 0
- unsupported: EM 0, token-F1 0, ROUGE-L 0, refusal 0.8, invalid 0

Failure categories: {"fail_low_f1":50,"unsupported_refusal":8,"unsupported_answered":2}

## Config Diff Highlights

- Served vs Baseline 1 selected differences: {"config.dtype":{"left":"float32","right":"bfloat16"},"config.quantization_config":{"left":{"_load_in_4bit":true,"_load_in_8bit":false,"bnb_4bit_compute_dtype":"bfloat16","bnb_4bit_quant_storage":"uint8","bnb_4bit_quant_type":"nf4","bnb_4bit_use_double_quant":true,"llm_int8_enable_fp32_cpu_offload":false,"llm_int8_has_fp16_weight":false,"llm_int8_skip_modules":null,"llm_int8_threshold":6,"load_in_4bit":true,"load_in_8bit":false,"quant_method":"bitsandbytes"}},"config.use_cache":{"left":false,"right":true}}
- Served vs local PPO selected differences: {}
- Local PPO has adapter_config.json: true
- Served repo has adapter_config.json: false

## Root Cause Ranking

1. Serving/config/model mismatch: notebook-style direct prompting failed on exact SFT-style questions.

Additional lineage note: the served config matches the local PPO inference actor on selected config fields, while differing from Baseline 1 merged-model config in dtype, quantization_config, and use_cache. Because the PPO manifest says it did not start from previous-stage SFT/RAG weights or adapters, Baseline 1 exact-answer reproduction should not be assumed for nfdlh/tensortalk-v2 without a model-upload/lineage check.

## Recommended Fix Groups

Config-only:
- Align request-time generation with the notebook before changing prompts: max tokens around 160 for Baseline 1 reproduction, deterministic decoding, repetition_penalty 1.02, and thinking disabled at template level where the serving stack supports it.
- Verify EOS/PAD handling because the notebook uses tokenizer eos as generation eos and pad, while configs encode pad as <|endoftext|>.

Endpoint-only:
- If calls time out or return no completions, inspect RunPod worker state, vLLM logs, model load errors, and whether the endpoint cache is still serving the intended nfdlh/tensortalk-v2.
- Confirm vLLM accepts chat_template_kwargs.enable_thinking=false or replace it with an endpoint-supported equivalent.

Model-upload:
- If exact SFT-style notebook prompting fails after endpoint health is fixed, compare the served model.safetensors against the intended local PPO or Baseline 1 merged model and re-upload to a versioned repo if hashes/lineage do not match.
- Decide whether the target is Baseline 1 SFT reproduction or Stage 3 PPO behavior; they are different artifacts with different evaluation evidence.

App changes:
- Only consider app prompt/harness changes after direct endpoint notebook-style prompting succeeds. If direct succeeds and app No RAG fails, then compare the app flattened prompt against the notebook chat template.

## Evidence Files

- outputs/eval-set.json
- outputs/results.jsonl
- outputs/results.csv
- outputs/summary.json
- outputs/config-diff.json
- outputs/notebook-local-claims.json
