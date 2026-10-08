import express from "express";
import path from "node:path";
import { configureAuth } from "@fieldpulse/auth";
import { config } from "./config.js";
import { createAuthMiddleware } from "./auth.js";
import { listRuns, getRun, reviewRun } from "./db/runs.js";
import { listCustomers } from "./db/customers.js";

export const app = express();
app.use(express.json());

if (config.FP_AUTH_URL) {
  configureAuth({ url: config.FP_AUTH_URL });
  app.use("/api", createAuthMiddleware());
  console.log(`[AUTH] FieldPulse sign-in required on /api (${config.FP_AUTH_URL})`);
} else {
  console.warn("[AUTH] FP_AUTH_URL is not set -- the API is open. Fine locally, never in production.");
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/customers", async (_req, res) => {
  try {
    res.json(await listCustomers());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/runs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    res.json(await listRuns(limit));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/runs/:id", async (req, res) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "not found" });
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Review: approve or reject. The reviewer is the signed-in FieldPulse user when
// auth is on; "local" when the API is open (dev only).
for (const decision of ["approved", "rejected"] as const) {
  app.post(`/api/runs/:id/${decision === "approved" ? "approve" : "reject"}`, async (req, res) => {
    try {
      const reviewer = (res.locals.claims?.email as string | undefined) ?? "local";
      const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 2000) : null;
      const result = await reviewRun(req.params.id, decision, reviewer, note);
      if (!result.ok) return res.status(result.reason === "not found" ? 404 : 409).json({ error: result.reason });
      res.json({ ok: true, status: decision, reviewed_by: reviewer });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

// Serve the built frontend when it exists (production).
const frontendDist = path.join(import.meta.dirname, "../frontend/dist");
app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) res.status(404).send("frontend not built -- run `npm run build`");
  });
});
