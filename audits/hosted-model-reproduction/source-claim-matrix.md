# TensorTalk Source Claim Matrix

This note records why the hosted `nfdlh/tensortalk-v2` behavior is explainable when compared against the proposal report text, the Hugging Face notebooks, and the local PPO artifact folder.

It is intentionally source-focused. It does not change the app harness, RAG, web search, UI, or production behavior.

## Sources Used

| Source | Location | What it proves |
| --- | --- | --- |
| Proposal report text | `/Users/nurfadilah/.codex/attachments/47dd964c-8588-4f81-94eb-301c422dca33/pasted-text.txt` | Project intent and methodology: Baseline 2 is RAG + harness; PPO is described as planned/final improvement, not as a reported final metric result. |
| Baseline 1 notebook | `TensorCat/TensorTalk/UM_Handbook/Baseline_1_SFT_QWEN3_UM_Handbook_.ipynb` | Closed-book SFT evaluation protocol and reported EM/token-F1/ROUGE-L metrics. |
| Baseline 2 notebook outputs | `TensorCat/TensorTalk/UM_Handbook/outputs/baseline2_rag_harness_agent/` | Retrieval and RAG-conditioned generation metrics. |
| Local PPO artifacts | `/Users/nurfadilah/Downloads/ppo_qwen3_um_handbook_stage3_rule_reward_ppo` | Stage 3 PPO training proof, local inference actor files, reward checks, and sampled validation predictions. |
| Hosted model audit | `audits/hosted-model-reproduction/outputs/` | Measured behavior of the hosted endpoint and app No RAG path. |

## What The Proposal Report Claims

The pasted report is a proposal/methodology report. It describes a system design and evaluation strategy, but it does not provide final measured PPO EM/token-F1/ROUGE numbers.

Key claims from the report:

- Baseline 1 is closed-book LoRA SFT on handbook Q&A.
- Baseline 2 is the same LLM with RAG evidence, metadata rerank, and agent harness.
- The improved/final model is the same LLM + RAG, then PPO on preference pairs.
- PPO is described as planned after preference-pair validation.
- Evaluation is described as retrieval correctness, token-F1, ROUGE/BLEU-style checks, manual review, and Qwen judge checks.
- The report says Baseline 2 reduces hallucination by adding RAG, metadata reranking, Qwen judge checks, fake-URL rejection, WAF handling, and answer-grounding validation.

Important interpretation:

The report does not claim that the final PPO bare model, without RAG or harness evidence, achieved a specific score.

## What The Notebook Outputs Actually Show

Baseline 2 is the closest match to the report's stronger behavior because it evaluates retrieval and RAG-conditioned generation.

Saved Baseline 2 metrics:

| Metric | Value |
| --- | ---: |
| Retrieval eval size | 1000 |
| Retriever | dense BGE embeddings + FAISS + metadata rerank |
| Top-k | 3 |
| hit@1 primary | 0.821 |
| hit@k primary | 0.954 |
| hit@k same group | 0.991 |
| Scope match at 1 | 0.996 |
| Generation eval size | 20 |
| Plain/no-RAG token-F1 | 0.3391 |
| RAG token-F1 | 0.846 |

This means the strong result is evidence-conditioned. The same notebook shows that plain model generation is weak.

## What The Local PPO Folder Proves

The local folder does contain a fine-tuned model artifact:

```text
/Users/nurfadilah/Downloads/ppo_qwen3_um_handbook_stage3_rule_reward_ppo/ppo_inference_actor_model/model.safetensors
```

It also contains config, generation config, tokenizer config, chat template, adapter files, training manifest, parameter-change proof, training logs, reward checks, and sampled validation predictions.

Important local PPO facts from `ppo_training_manifest.json`:

```text
stage = Stage 3 PPO
status = completed
train_rows = 900
valid_rows = 100
total_planned_steps = 900
actual_training_log_records = 900
ppo_inference_full_weights_found = true
ppo_lora_adapter_found = true
```

The critical lineage field is:

```text
ppo_initial_actor_source.mode = base_plus_fresh_ppo_lora
uses_previous_stage_weights = false
uses_previous_stage_adapter = false
```

So this PPO run is fine-tuned, but it is not proven to be Baseline 1 SFT or Baseline 2 RAG-SFT continued with PPO.

The PPO folder's eval-like artifacts are:

| Artifact | Meaning |
| --- | --- |
| `ppo_validation_predictions.csv` | Sampled PPO validation predictions with reward, gold_overlap, rejected_overlap, prediction, and gold. Parsed row count: 30. |
| `reward_model_metrics.json` | Rule-based reward setup and sanity metrics. It explicitly says no separate neural reward model is used. |
| `rule_reward_sanity_check.json` | Checks chosen/rejected/collapse reward ordering. |
| `ppo_execution_proof.json` | Training ran for the planned 900 records/steps. |
| `ppo_parameter_change_proof.json` | All 506 common trainable tensors changed. |

What the PPO folder does not contain:

- A held-out `test_metrics.json`.
- A final PPO EM/token-F1/ROUGE report.
- A Baseline 2-style `generation_metrics.json`.
- A proof that PPO bare-model generation should match the report's RAG-conditioned behavior.

## What We Are Serving

The app is configured for:

```text
TENSORTALK_MODEL=nfdlh/tensortalk-v2
```

The hosted model config matches the local PPO inference actor on selected config fields:

- architecture: `Qwen3ForCausalLM`
- model type: `qwen3`
- dtype: `float32`
- 4-bit bitsandbytes quantization config
- generation config: `temperature=0.6`, `top_p=0.95`, `top_k=20`
- tokenizer config
- chat template SHA

So the issue is not that we accidentally served the base Qwen model. We are serving the PPO fine-tuned model or a close upload of the local PPO inference actor.

## What The Hosted Audit Measured

The audit used 60 questions:

- 25 exact SFT-style questions.
- 25 paraphrased questions.
- 10 unsupported/off-domain questions.

Measured results:

| Path | Exact SFT EM | Exact SFT token-F1 | Notes |
| --- | ---: | ---: | --- |
| Direct endpoint, notebook-style chat prompt | 0 | 0.3306 | Returns non-empty answers, but low overlap with references. |
| Direct endpoint, plain user prompt | 0 | 0 | Empty final answer for all 25 exact rows after thinking stripping. |
| App `/api/chat`, No RAG, web off | 0 | 0.2621 | Non-empty, but lower than direct notebook-style prompt. |

Unsupported/off-domain behavior:

| Path | Refusal rate |
| --- | ---: |
| Direct notebook-style chat prompt | 0.5 |
| Direct plain user prompt | 0 |
| App No RAG | 0.8 |

## Is This Expected?

Mostly yes, given the available evidence.

Expected:

- A bare/no-RAG model result around the weak Baseline 2 plain generation result is plausible.
- The hosted PPO model not reproducing Baseline 2 RAG token-F1 is expected because Baseline 2's strong score depends on retrieved evidence in the prompt.
- The PPO folder does not provide a final EM/token-F1/ROUGE report proving the PPO bare model should perform well alone.
- The report describes PPO as planned/final methodology, not as a scored final bare-model benchmark.

Unexpected or concerning:

- Plain user prompts often produce only thinking content or empty final answers after stripping. This points to a serving/chat-template/thinking-control mismatch.
- Unsupported questions are mixed: direct notebook-style prompting answered 5/10 unsupported questions, direct plain mostly produced empty final answers, and app No RAG still answered 2/10 unsupported questions.
- App No RAG is weaker than direct notebook-style prompting, which means the app prompt is not equivalent to the notebook prompt. This is secondary because both are weak without RAG.

## Practical Conclusion

The repo should not present `nfdlh/tensortalk-v2` as reproducing the report's full TensorTalk system by itself.

Accurate wording:

```text
The deployed model is the Stage 3 PPO inference actor derived from the local PPO artifact folder. The report's stronger expected behavior is for the full TensorTalk system with RAG evidence and harness controls. In audit, the hosted PPO model alone behaved like a weak/no-RAG generator, which is broadly consistent with Baseline 2's plain generation result rather than its RAG-conditioned result.
```

Recommended next checks before changing production behavior:

1. Run the same 60-question audit through app semantic RAG with web off.
2. Compare app semantic RAG to Baseline 2 RAG metrics and evidence traces.
3. If PPO quality must be claimed, create a real PPO evaluation report with EM/token-F1/ROUGE on a fixed held-out set.
4. Fix direct endpoint thinking behavior only after deciding whether the target is bare PPO behavior or full RAG+harness behavior.
