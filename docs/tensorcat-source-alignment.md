# TensorCat Source Alignment

This document records the source/data pipeline comparison against
`https://huggingface.co/TensorCat/TensorTalk` for the runtime app in this repo.
It is not an evaluation harness.

## Upstream source inventory

The TensorCat/TensorTalk Hub repo contains these non-weight source artifacts:

- `UM_Handbook/Dataset/pdf/General Handbook.pdf`
- `UM_Handbook/Dataset/pdf/Complete Handbook.pdf`
- `UM_Handbook/um_handbook_config.py`
- `UM_Handbook/UM_Handbook_Markdown_Preprocess.py`
- `UM_Handbook/Dataset/Markdown/PG_Handbook_Clean.md`
- `UM_Handbook/Dataset/Markdown/UG_Handbook_Clean.md`
- `UM_Handbook/Dataset/Manual_Index/UM_Manual_Core_Question_Index.json`
- `UM_Handbook/UM_Source_Chunk_Dataset_Builder.py`
- `UM_Handbook/Dataset/Source Chunk Dataset/Source_Chunks_Dataset.jsonl`
- `UM_Handbook/UM_SFT_QA_Dataset_Builder_from_Index.py`
- `UM_Handbook/Dataset/SFT_Dataset/SFT_QA_Training_Ready.jsonl`
- `UM_Handbook/Dataset/SFT_Dataset/SFT_QA_Metadata.jsonl`
- `UM_Handbook/Dataset/RAG/UM_RAG_Knowledge_Base.jsonl`
- `UM_Handbook/outputs/baseline2_rag_harness_agent/rag_augmented_dataset/rag_augmented_sft_dataset.jsonl`

The upstream RAG knowledge base has 521 rows with this distribution:

```text
general: 58
postgraduate: 250
undergraduate: 213
```

The upstream source chunk report says those 521 chunks are generated from
structured Markdown, not directly from raw PDF pages. Low-information cover,
contents, and divider chunks are filtered out, page metadata is preserved, and
manual-index IDs are linked by exact section/subsection matches.

## Current runtime status

This app intentionally packages the runtime artifacts needed by Next.js:

- `data/UM_RAG_Knowledge_Base.jsonl`
- `data/UM_RAG_Vectors.sqlite`
- `scripts/build-rag-index.ts`
- `lib/rag.ts`

The local RAG KB also has 521 rows and the same field schema as upstream:

```text
chunk_index
chunk_question_variants
grounded_answer_bank
group_canonical_questions
group_size_chunks
group_size_qas
kb_id
knowledge_group_id
linked_index_ids
matched_qa_ids
pages
retrieval_keywords
retrieval_tags
retrieval_text
scope_label
section
source_chunk_id
source_doc
source_text
subsection
title
```

The local KB is not byte-identical to upstream. There are three deliberate
content differences:

```text
RAGKB-0002
- Upstream grounded_answer_bank/retrieval_keywords say "304 students".
- The upstream source_text says "total of 300 students".
- The local KB keeps "300 students" to match the source text.

RAGKB-0123
- Local KB adds a grounded_answer_bank entry for online thesis/dissertation
  submission requirements.

RAGKB-0124
- Local KB adds a grounded_answer_bank entry for examination/final thesis
  submission document requirements.
```

Because of those corrections/additions, replacing the local KB wholesale with
the upstream file would reduce source fidelity for at least `RAGKB-0002`.

## Runtime substitution

TensorCat baseline 2 uses:

```text
Embedding model: BAAI/bge-base-en-v1.5
Vector store: FAISS
Similarity: inner product after normalization
Top-k retrieval: 3
Rerank: dense score + metadata-aware rerank
```

This app keeps the same embedding model, normalized inner-product retrieval,
top-k 3 semantic evidence, and metadata-aware rerank behavior, but stores
vectors in `data/UM_RAG_Vectors.sqlite` instead of FAISS so the Next.js API can
load the index in the server runtime.

The index builder embeds `retrieval_text`, stores the complete row JSON beside
the vector, records the embedding model in `rag_meta`, and validates the runtime
embedding model/dimension before serving semantic retrieval.

## Missing upstream pipeline pieces

The runtime repo does not currently contain the full upstream data build chain:

- PDF-to-Markdown preprocessing with PyMuPDF, OCR, page filters, and manual
  visual override text.
- Manual index file and source-chunk builder.
- SFT dataset builders and training-ready SFT datasets.
- RAG-augmented SFT dataset builder output.
- Notebook-only browser/static official-web helper cells.
- FAISS index artifact.

Those are source/training pipeline assets, not required for the current
deployed chat path. If the runtime KB must be regenerated from TensorCat
sources later, the smallest aligned path is:

1. Pull the upstream `UM_Handbook/Dataset/pdf`, `Dataset/Markdown`,
   `Dataset/Manual_Index`, `um_handbook_config.py`, and builder scripts.
2. Rebuild `Source_Chunks_Dataset.jsonl`.
3. Rebuild `UM_RAG_Knowledge_Base.jsonl`.
4. Reapply the known `RAGKB-0002`, `RAGKB-0123`, and `RAGKB-0124` source-fidelity
   corrections if upstream has not fixed them.
5. Run `pnpm rag:index` to regenerate `data/UM_RAG_Vectors.sqlite`.

Until then, the authoritative runtime data source remains the checked-in
`data/UM_RAG_Knowledge_Base.jsonl` plus `data/UM_RAG_Vectors.sqlite`.
