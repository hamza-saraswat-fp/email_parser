import express from "express";
import path from "node:path";
import { listRuns, getRun } from "./db/runs.js";
import { listCustomers } from "./db/customers.js";

export const app = express();
app.use(express.json());

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

// Serve the built frontend when it exists (production).
const frontendDist = path.join(import.meta.dirname, "../frontend/dist");
app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) res.status(404).send("frontend not built -- run `npm run build`");
  });
});
