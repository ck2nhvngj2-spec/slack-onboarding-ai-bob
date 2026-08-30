/**
 * answerAgent.ts
 *
 * Queries the ChromaDB "project-corpus" collection for chunks relevant to the
 * user's question and assembles a grounded answer response.
 *
 * Corpus grounding notes (from ingested seed-repo):
 *  - README.md   — stack (Node/Express/TS), auth ownership, payments team owner (Sarah Jenkins)
 *  - auth.ts     — verifyToken with TODO: Redis blocklist
 *  - bug-report-104.txt — BUG-104: verifyToken CI flake, Redis startup race, 2s delay workaround
 */

import { ChromaClient } from "chromadb";
import type { Collection } from "chromadb";

/** A single retrieved chunk with its source file and similarity distance. */
export interface RetrievedChunk {
  text: string;
  source: string;
  /** Raw distance from ChromaDB (lower = more similar). */
  distance: number;
}

/** The full output of answerAgent — ready for the confidence gate. */
export interface AgentResult {
  question: string;
  /** Top-k chunks retrieved from the corpus. */
  chunks: RetrievedChunk[];
  /**
   * Synthesised answer built from the retrieved chunks.
   * "The documentation doesn't cover this" when no relevant chunks are found.
   */
  answer: string;
  /**
   * The best (lowest) distance seen across all returned chunks.
   * Used by confidenceGate to derive a 0–1 confidence score.
   */
  bestDistance: number;
}

const CHROMA_URL = process.env["CHROMA_URL"] ?? "http://localhost:8000";
const COLLECTION_NAME = "project-corpus";
const TOP_K = 5;

let _collection: Collection | null = null;

async function getCollection(): Promise<Collection> {
  if (_collection) return _collection;
  const client = new ChromaClient({ path: CHROMA_URL });
  _collection = await client.getOrCreateCollection({ name: COLLECTION_NAME });
  return _collection;
}

/**
 * Query the corpus and build a grounded answer.
 *
 * @param question - The raw question text from the user.
 * @returns AgentResult containing retrieved chunks, synthesised answer, and best distance.
 */
export async function answerQuestion(question: string): Promise<AgentResult> {
  const collection = await getCollection();

  const result = await collection.query({
    queryTexts: [question],
    nResults: TOP_K,
    include: ["documents", "metadatas", "distances"],
  });

  // result.documents[0] and result.distances[0] correspond to the single query text.
  const rawDocs = result.documents[0] ?? [];
  const rawDistances = result.distances[0] ?? [];
  const rawMetas = result.metadatas[0] ?? [];

  const chunks: RetrievedChunk[] = rawDocs
    .map((doc, i) => ({
      text: doc ?? "",
      source: (rawMetas[i] as { source?: string } | null)?.source ?? "unknown",
      distance: rawDistances[i] ?? 1,
    }))
    .filter((c) => c.text.length > 0);

  if (chunks.length === 0) {
    return {
      question,
      chunks: [],
      answer:
        "The documentation doesn't cover this; I'd recommend asking your team lead.",
      bestDistance: 1,
    };
  }

  const bestDistance = Math.min(...chunks.map((c) => c.distance));

  // Build answer by surfacing the most relevant chunks as context paragraphs.
  const contextBlock = chunks
    .slice(0, 3)
    .map((c, i) => `[${i + 1}] (${c.source}): ${c.text.trim()}`)
    .join("\n\n");

  const answer =
    `Based on the project corpus:\n\n${contextBlock}`;

  return { question, chunks, answer, bestDistance };
}
