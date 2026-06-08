import type { Metadata } from "next";

import { EmbeddingAtlasClient } from "@/components/embedding-atlas-client";

export const metadata: Metadata = {
  title: "TensorTalk Embedding Atlas",
  description: "Interactive visualization of TensorTalk handbook embeddings.",
};

export default function EmbeddingsPage() {
  return <EmbeddingAtlasClient />;
}
