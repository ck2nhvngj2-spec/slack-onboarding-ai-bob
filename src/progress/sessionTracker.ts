/**
 * sessionTracker.ts
 *
 * Tracks which source files and concepts a user has accessed per session,
 * and surfaces a proactive "Mentor Mode" tip the first time each concept
 * is encountered.
 *
 * ## Design
 *
 * - Sessions are identified by an opaque string ID (e.g. from the
 *   X-Session-ID request header).  Sessions are held in-memory; they
 *   are intentionally ephemeral — no persistence is needed for onboarding.
 *
 * - A "concept" is derived from two sources:
 *     1. The `source` filenames returned by the ChromaDB retrieval
 *        (e.g. "auth.ts", "README.md").
 *     2. Keyword concepts extracted from the user's question text against
 *        a known corpus vocabulary.
 *
 * - The first time a session encounters a concept, `recordAndGetTip()`
 *   returns a MentorTip grounded in the actual seed-repo corpus.
 *   Subsequent accesses return null (no tip — the user already saw it).
 *
 * ## Corpus-grounded tip catalogue
 *
 * Every tip below is derived directly from seed-repo content:
 *
 *  auth.ts        — verifyToken has a Redis TODO; real blocklist not yet wired.
 *                   Exercise: add a real Redis call and write a unit test for it.
 *
 *  bug-report-104 — CI flake caused by Redis startup race; 2-second delay workaround.
 *                   Exercise: replace the delay with a proper health-check/wait loop.
 *
 *  README.md      — payments module owned by Billing Team (Sarah Jenkins).
 *                   Rule: every new route needs docs + unit tests.
 *                   Exercise: document a new mock route following that convention.
 *
 *  auth (keyword) — same tips as auth.ts above.
 *  payments       — same tips as README.md / billing above.
 *  testing / ci   — same tips as bug-report-104 above.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface MentorTip {
  /** Short heading shown to the user. */
  heading: string;
  /** Contextual explanation grounded in the corpus. */
  body: string;
  /** Optional guided exercise for the user to try. */
  exercise: string | null;
  /** The concept key that triggered this tip. */
  concept: string;
}

export interface FinalResponse {
  /** Populated only on first access of a new concept; null otherwise. */
  mentorTip: MentorTip | null;
  /** Concepts seen in this session, including the current turn. */
  sessionConcepts: string[];
}

// ── Tip catalogue (corpus-grounded) ───────────────────────────────────────

/**
 * Maps a normalised concept key to a MentorTip.
 * Keys are lowercase, matching source filenames or extracted keywords.
 */
const TIP_CATALOGUE: Record<string, Omit<MentorTip, "concept">> = {
  "auth.ts": {
    heading: "💡 Gotcha: verifyToken is not production-ready",
    body:
      "The `verifyToken` function in `auth.ts` currently accepts a hardcoded mock token " +
      "(`'valid-mock-token'`) and has a TODO comment: *'Connect to Redis for real token blocklist " +
      "validation'*. This means authentication is not enforced in the current codebase.",
    exercise:
      "Exercise: Replace the mock check with a real Redis `GET` call. " +
      "Then write a unit test that seeds the blocklist before running — " +
      "and add the 2-second startup delay documented in BUG-104 until a proper health-check loop is in place.",
  },

  "bug-report-104.txt": {
    heading: "💡 Known Issue: CI auth tests are flaky (BUG-104)",
    body:
      "BUG-104 (Status: Open) — The `verifyToken` unit test fails intermittently in GitHub Actions " +
      "because the Redis cache instance isn't ready before the test runs, causing a timeout. " +
      "The current workaround is a 2-second delay before the auth test suite.",
    exercise:
      "Exercise: Replace the 2-second `sleep` workaround with a proper Redis readiness loop " +
      "(e.g. poll `PING` until it responds, with a timeout). " +
      "This is a common CI pattern — try implementing it as a reusable `waitForRedis()` helper.",
  },

  "readme.md": {
    heading: "💡 Architecture: ownership and testing rules",
    body:
      "The README defines two key conventions: (1) all authentication logic lives in `auth.ts`; " +
      "(2) the payments module is owned by the Billing Team — lead: **Sarah Jenkins**. " +
      "Every new route must be documented and include unit tests.",
    exercise:
      "Exercise: Pick a hypothetical new route (e.g. `GET /invoices`) and document it " +
      "following the project's convention — write the JSDoc comment and a stub unit test file.",
  },

  // Keyword aliases map onto the same tips as the file they relate to.
  "auth": {
    heading: "💡 Gotcha: verifyToken is not production-ready",
    body:
      "The `verifyToken` function in `auth.ts` uses a hardcoded mock token. " +
      "A TODO marks where Redis blocklist validation should be wired in.",
    exercise:
      "Exercise: Implement the Redis blocklist check and write a unit test for it, " +
      "keeping BUG-104's 2-second startup delay in mind.",
  },

  "payments": {
    heading: "💡 Ownership: Payments module",
    body:
      "The payments module is owned by the Billing Team (Lead: Sarah Jenkins), " +
      "as documented in README.md. Changes to this module should be coordinated with that team.",
    exercise:
      "Exercise: Draft a short change-request message to Sarah Jenkins describing " +
      "a fictional new payments feature, following the project's documentation convention.",
  },

  "testing": {
    heading: "💡 Convention: every new route needs unit tests",
    body:
      "The README states: *'Every new route must be documented and include unit tests.'* " +
      "BUG-104 also highlights that test environment setup (e.g. Redis startup) must be handled " +
      "carefully to avoid flaky CI runs.",
    exercise:
      "Exercise: Write a test stub for a new route of your choice. " +
      "Include a `beforeAll` hook that waits for any required services to be ready.",
  },

  "ci": {
    heading: "💡 Known Issue: CI auth tests are flaky (BUG-104)",
    body:
      "BUG-104 documents a race condition between the Redis instance and the auth test suite " +
      "in the GitHub Actions pipeline. Workaround: add a 2-second delay before the suite.",
    exercise:
      "Exercise: Replace the hardcoded delay with a `waitForRedis()` health-check helper " +
      "and open a follow-up PR to close BUG-104.",
  },
};

// ── Concept extraction ─────────────────────────────────────────────────────

/**
 * Keyword → concept key map.
 * Order matters: more specific patterns are checked first.
 */
const KEYWORD_CONCEPTS: Array<{ pattern: RegExp; concept: string }> = [
  { pattern: /\bverifyToken\b|\bjwt\b|\btoken\b|\bauth(?:entication|oriz)?\b/i, concept: "auth" },
  { pattern: /\bpayments?\b|\bbilling\b|\binvoice\b/i, concept: "payments" },
  { pattern: /\bCI\/CD\b|\bCI\b|\bgithub actions\b|\bpipeline\b/i, concept: "ci" },
  { pattern: /\bunit test\b|\btest(?:ing|s)?\b|\bspec\b/i, concept: "testing" },
];

/**
 * Derive a set of concept keys from the retrieved source filenames and the
 * raw question text.  Filenames are normalised to lowercase.
 */
export function extractConcepts(sources: string[], question: string): string[] {
  const seen = new Set<string>();

  // 1. Source files directly
  for (const src of sources) {
    const key = src.toLowerCase();
    if (key in TIP_CATALOGUE) seen.add(key);
  }

  // 2. Keywords from the question
  for (const { pattern, concept } of KEYWORD_CONCEPTS) {
    if (pattern.test(question) && concept in TIP_CATALOGUE) {
      seen.add(concept);
    }
  }

  return Array.from(seen);
}

// ── Session store ──────────────────────────────────────────────────────────

/** Set of already-seen concept keys, keyed by session ID. */
const _sessions = new Map<string, Set<string>>();

/**
 * Return (creating if necessary) the seen-concept set for a session.
 */
function getOrCreateSession(sessionId: string): Set<string> {
  let session = _sessions.get(sessionId);
  if (!session) {
    session = new Set<string>();
    _sessions.set(sessionId, session);
  }
  return session;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Record the concepts touched in this turn and return a MentorTip for the
 * first new concept encountered, or null if all concepts are already known.
 *
 * @param sessionId  - Opaque session identifier (e.g. from X-Session-ID header).
 * @param sources    - Source filenames from the ChromaDB retrieval.
 * @param question   - Raw question text from the user.
 */
export function recordAndGetTip(
  sessionId: string,
  sources: string[],
  question: string
): FinalResponse {
  const seenConcepts = getOrCreateSession(sessionId);
  const touched = extractConcepts(sources, question);

  let mentorTip: MentorTip | null = null;

  for (const concept of touched) {
    if (!seenConcepts.has(concept)) {
      seenConcepts.add(concept);
      // Return the tip for the first new concept only.
      if (!mentorTip) {
        const catalogueEntry = TIP_CATALOGUE[concept];
        if (catalogueEntry) {
          mentorTip = { ...catalogueEntry, concept };
        }
      }
    } else {
      // Concept already seen — still record it for the sessionConcepts snapshot.
      seenConcepts.add(concept);
    }
  }

  return {
    mentorTip,
    sessionConcepts: Array.from(seenConcepts),
  };
}

/**
 * Return all concept keys seen so far in a session, or an empty array if
 * the session doesn't exist yet.
 */
export function getSessionProgress(sessionId: string): string[] {
  return Array.from(_sessions.get(sessionId) ?? []);
}
