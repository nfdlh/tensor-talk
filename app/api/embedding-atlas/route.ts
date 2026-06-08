import { NextResponse } from "next/server";

import { getEmbeddingAtlasPayload } from "@/lib/embedding-atlas-data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await getEmbeddingAtlasPayload();

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load the embedding visualizer.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
