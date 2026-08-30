/**
 * server.ts
 *
 * Express HTTP server exposing the onboarding chatbot answer endpoint.
 *
 * Endpoints
 * ---------
 * POST /ask
 *   Body:    { "question": "string" }
 *   Headers: X-Session-ID (optional — a new session is created if absent)
 *   Returns: FullResponse (answer, confidence, escalate, sources, actions,
 *                          mentorTip, sessionConcepts)
 *
 * GET /progress/:sessionId
 *   Returns: { "sessionId": string, "concepts": string[] }
 *
 * GET /health
 *   Returns: { "status": "ok" }
 */

import crypto from "crypto";
import express from "express";
import type { Request, Response } from "express";
import { answerQuestion } from "../answer/answerAgent.js";
import { applyConfidenceGate } from "../answer/confidenceGate.js";
import { chainActions } from "../actions/actionChainer.js";
import type { ActionChainedResponse } from "../actions/actionChainer.js";
import { maybeEscalate } from "../escalation/escalationLogger.js";
import { recordAndGetTip, getSessionProgress } from "../progress/sessionTracker.js";
import type { MentorTip } from "../progress/sessionTracker.js";

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// POST /ask
// ---------------------------------------------------------------------------
// ── Response type ──────────────────────────────────────────────────────────

interface FullResponse extends ActionChainedResponse {
  sessionId: string;
  mentorTip: MentorTip | null;
  sessionConcepts: string[];
}

// ── POST /ask ──────────────────────────────────────────────────────────────

interface AskBody {
  question?: unknown;
}

app.post("/ask", (req: Request<{}, FullResponse | { error: string }, AskBody>, res: Response) => {
  const { question } = req.body;

  if (typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "Request body must include a non-empty 'question' string." });
    return;
  }

  // Resolve or mint a session ID.
  const sessionId =
    typeof req.headers["x-session-id"] === "string" && req.headers["x-session-id"].trim().length > 0
      ? req.headers["x-session-id"].trim()
      : crypto.randomUUID();

  answerQuestion(question.trim())
    .then((agentResult) => {
      const gated = applyConfidenceGate(agentResult);
      maybeEscalate(gated);
      const chained = chainActions(gated);

      // Progress tracker: derive concepts from retrieved sources + question text.
      const sourceNames = gated.sources.map((s) => s.source);
      const { mentorTip, sessionConcepts } = recordAndGetTip(sessionId, sourceNames, question.trim());

      const full: FullResponse = {
        ...chained,
        sessionId,
        mentorTip,
        sessionConcepts,
      };

      res.json(full);
    })
    .catch((err: unknown) => {
      console.error("[/ask] Error:", err);
      res.status(500).json({ error: "Internal server error while querying the corpus." });
    });
});

// ── GET /progress/:sessionId ───────────────────────────────────────────────

app.get("/progress/:sessionId", (req: Request<{ sessionId: string }>, res: Response) => {
  const { sessionId } = req.params;
  res.json({ sessionId, concepts: getSessionProgress(sessionId) });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Onboarding chatbot listening on http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/ask  { "question": "..." }`);
  console.log(`  GET  http://localhost:${PORT}/progress/:sessionId`);
});
