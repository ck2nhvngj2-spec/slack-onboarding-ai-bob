/**
 * actionChainer.ts
 *
 * Analyses a GatedResponse for implied follow-up actions and appends
 * zero or more suggested actions to it.
 *
 * ## Detection rules (grounded in seed-repo corpus)
 *
 * 1. FILE_FETCH   — answer text contains a recognisable file path pattern
 *                   (e.g. "auth.ts", "src/payments/index.ts").
 *                   Suggestion: "Would you like me to fetch <path> and explain its function?"
 *
 * 2. BUG_SEARCH   — answer text references a bug ticket ID (e.g. BUG-104)
 *                   or keywords like "intermittent", "flaky", "race condition", "CI".
 *                   Suggestion: "Would you like me to search closed issues for similar
 *                   symptoms and open a new ticket if needed?"
 *
 * 3. OWNER_CONTACT — answer text names a team owner or lead
 *                   (e.g. "Sarah Jenkins", "Billing Team").
 *                   Suggestion: "Would you like me to draft a message to <owner>?"
 */

import type { GatedResponse } from "../answer/confidenceGate.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type ActionKind = "FILE_FETCH" | "BUG_SEARCH" | "OWNER_CONTACT";

export interface SuggestedAction {
  kind: ActionKind;
  /** Human-readable prompt shown to the user. */
  suggestion: string;
  /** Machine-readable payload for downstream tooling. */
  payload: Record<string, string>;
}

export interface ActionChainedResponse extends GatedResponse {
  actions: SuggestedAction[];
}

// ── Detection patterns ─────────────────────────────────────────────────────

/**
 * Matches file paths: a word containing a dot-extension with optional
 * leading path segments, e.g. "auth.ts", "src/payments/index.ts".
 */
const FILE_PATH_RE = /\b(?:[\w./-]+\/)?[\w-]+\.\w{1,6}\b/g;

/**
 * Matches explicit bug ticket IDs (BUG-NNN) or flakiness keywords.
 */
const BUG_RE =
  /\bBUG-\d+\b|\bintermittent\b|\bflaky\b|\brace condition\b|\bCI\/CD\b|\bCI\b/i;

/**
 * Known owners from the README.md corpus entry:
 *   "the payments module is owned by the Billing Team (Lead: Sarah Jenkins)"
 * Add more entries here as the corpus grows.
 */
const KNOWN_OWNERS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /Sarah Jenkins/i, label: "Sarah Jenkins (Billing Team Lead)" },
  { pattern: /Billing Team/i, label: "the Billing Team" },
];

// ── Detector functions ─────────────────────────────────────────────────────

function detectFileFetch(text: string): SuggestedAction[] {
  const matches = Array.from(new Set(text.match(FILE_PATH_RE) ?? []));
  // Filter out noise: must end in a known code/doc extension.
  const codeExtensions = /\.(ts|js|tsx|jsx|py|md|json|yaml|yml|txt|sh)$/i;
  const paths = matches.filter((m) => codeExtensions.test(m));
  return paths.map((p) => ({
    kind: "FILE_FETCH" as ActionKind,
    suggestion: `Would you like me to fetch \`${p}\` and explain its function?`,
    payload: { path: p },
  }));
}

function detectBugSearch(text: string): SuggestedAction[] {
  if (!BUG_RE.test(text)) return [];
  const ticketMatch = text.match(/\bBUG-\d+\b/);
  const symptom = ticketMatch ? ticketMatch[0] : "similar symptoms";
  return [
    {
      kind: "BUG_SEARCH" as ActionKind,
      suggestion: `Would you like me to search closed issues for ${symptom} and open a new ticket if needed?`,
      payload: { symptom: symptom },
    },
  ];
}

function detectOwnerContact(text: string): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  for (const owner of KNOWN_OWNERS) {
    if (owner.pattern.test(text)) {
      actions.push({
        kind: "OWNER_CONTACT" as ActionKind,
        suggestion: `Would you like me to draft a message to ${owner.label}?`,
        payload: { owner: owner.label },
      });
      break; // one contact suggestion per response is enough
    }
  }
  return actions;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Analyse a GatedResponse for implied actions and return an enriched
 * ActionChainedResponse.  The original response is never mutated.
 */
export function chainActions(response: GatedResponse): ActionChainedResponse {
  const searchText = `${response.answer} ${response.sources.map((s) => s.source).join(" ")}`;

  const actions: SuggestedAction[] = [
    ...detectFileFetch(searchText),
    ...detectBugSearch(searchText),
    ...detectOwnerContact(searchText),
  ];

  return { ...response, actions };
}
