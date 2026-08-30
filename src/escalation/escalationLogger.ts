/**
 * escalationLogger.ts
 *
 * Logs low-confidence responses to a newline-delimited JSON file so a human
 * mentor can review them asynchronously.
 *
 * ## Log format (one JSON object per line)
 *
 * {
 *   "timestamp": "2099-01-01T09:00:00.000Z",
 *   "question":  "How does token verification work?",
 *   "confidence": 0.42,
 *   "answer":    "Based on the project corpus: ...",
 *   "sources":   [{ "source": "auth.ts", "distance": 0.91 }]
 * }
 *
 * Log file location defaults to ./escalation.log and is tunable via
 * ESCALATION_LOG_PATH env var.
 */

import * as fs from "fs";
import * as path from "path";
import type { GatedResponse } from "../answer/confidenceGate.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface EscalationEntry {
  timestamp: string;
  question: string;
  confidence: number;
  answer: string;
  sources: Array<{ source: string; distance: number }>;
}

// ── Configuration ──────────────────────────────────────────────────────────

const LOG_PATH = path.resolve(
  process.env["ESCALATION_LOG_PATH"] ?? "./escalation.log"
);

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Append a single newline-delimited JSON entry to the log file.
 * Uses the synchronous fs API so the caller doesn't need to await —
 * logging should never block the HTTP response.
 */
function appendEntry(entry: EscalationEntry): void {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(LOG_PATH, line, "utf-8");
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * If the response has `escalate: true`, write it to the escalation log.
 * Safe to call on every response — no-ops when escalation is not needed.
 *
 * @returns true if an entry was written, false otherwise.
 */
export function maybeEscalate(response: GatedResponse): boolean {
  if (!response.escalate) return false;

  const entry: EscalationEntry = {
    timestamp: new Date().toISOString(),
    question: response.question,
    confidence: response.confidence,
    answer: response.answer,
    sources: response.sources,
  };

  try {
    appendEntry(entry);
    console.warn(
      `[escalation] Low-confidence response logged (confidence=${(response.confidence * 100).toFixed(0)}%): "${response.question}"`
    );
  } catch (err) {
    // Logging must never crash the server.
    console.error("[escalation] Failed to write escalation log:", err);
  }

  return true;
}

/**
 * Read and parse all escalation log entries from the log file.
 * Returns an empty array if the file does not exist yet.
 */
export function readEscalationLog(): EscalationEntry[] {
  if (!fs.existsSync(LOG_PATH)) return [];

  const raw = fs.readFileSync(LOG_PATH, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EscalationEntry);
}
