/**
 * confidenceGate.ts
 *
 * Converts raw ChromaDB retrieval distances into a normalised confidence
 * score and decides whether the answer should be served or escalated.
 *
 * ## Scoring model
 *
 * ChromaDB returns L2 / cosine distances where 0 = identical and higher
 * values mean less similar.  We map the best (lowest) distance to a
 * 0–1 confidence score with a simple exponential decay:
 *
 *   confidence = e^(-k * bestDistance)
 *
 * k is chosen so that distance 1.0 yields exactly 75% confidence:
 *   k = -ln(0.75) ≈ 0.2877
 *
 * Calibrated curve (default k = 0.2877):
 *   distance 0.00  → confidence 1.000  (exact match)
 *   distance 0.50  → confidence ~0.866
 *   distance 0.97  → confidence ~0.757  (observed real-world README.md hit)
 *   distance 1.00  → confidence  0.750  (design target)
 *   distance 2.00  → confidence ~0.562
 *
 * The escalation threshold defaults to 0.65 and is tunable via
 * CONFIDENCE_THRESHOLD env var.
 */

import type { AgentResult } from "./answerAgent.js";

/** Final output sent to the HTTP layer. */
export interface GatedResponse {
  question: string;
  answer: string;
  confidence: number;
  /** True when confidence is below the threshold — human review recommended. */
  escalate: boolean;
  /** Chunks surfaced for transparency / debugging. */
  sources: Array<{ source: string; distance: number }>;
}

// k = -ln(0.75) so that distance 1.0 → confidence 0.75
const DECAY_K = parseFloat(process.env["CONFIDENCE_DECAY_K"] ?? "0.2877");
const THRESHOLD = parseFloat(process.env["CONFIDENCE_THRESHOLD"] ?? "0.65");

/**
 * Convert a raw distance to a 0–1 confidence score.
 */
export function distanceToConfidence(distance: number): number {
  return Math.exp(-DECAY_K * distance);
}

/**
 * Apply the confidence gate to an AgentResult.
 *
 * - If confidence ≥ threshold → serve the answer as-is.
 * - If confidence <  threshold → mark escalate: true and append a note to
 *   the answer so the UI can surface a "contact a mentor" prompt.
 */
export function applyConfidenceGate(result: AgentResult): GatedResponse {
  const confidence = distanceToConfidence(result.bestDistance);
  const escalate = confidence < THRESHOLD;

  const answer = escalate
    ? `${result.answer}\n\n⚠️ Low confidence (${(confidence * 100).toFixed(0)}%). I recommend verifying this with a human mentor.`
    : result.answer;

  return {
    question: result.question,
    answer,
    confidence: parseFloat(confidence.toFixed(4)),
    escalate,
    sources: result.chunks.map((c) => ({
      source: c.source,
      distance: parseFloat(c.distance.toFixed(4)),
    })),
  };
}
