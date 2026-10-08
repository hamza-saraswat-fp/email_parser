// The pipeline's steps in order, so the UI can show where a run stopped and
// which steps never ran. Keep in sync with src/pipeline/run.ts.
export const PIPELINE_STEPS = ["received", "cleaned", "sorted", "extracted", "verified", "semantic", "checked"] as const;
export type StepName = (typeof PIPELINE_STEPS)[number];

export const STEP_LABELS: Record<string, string> = {
  received: "Received",
  cleaned: "Cleaned",
  classified: "Classified",
  sorted: "Sorted (Jev)",
  extracted: "Read (Sonnet)",
  verified: "Verified",
  semantic: "Semantic (Jev)",
  checked: "Required",
};

export const STEP_KIND: Record<string, "code" | "model"> = {
  received: "code", cleaned: "code", classified: "model", sorted: "model", extracted: "model", verified: "code", semantic: "model", checked: "code",
};

// Why a step did not run, given the run's final status and the last step seen.
export function notRunReason(status: string, lastStep: string | undefined): string {
  if (status === "running") return "waiting";
  if (status === "skipped") return "not needed (skipped at sort)";
  if (status === "failed") return `not reached (failed at ${lastStep ?? "start"})`;
  if (status === "needs_review" && lastStep === "sorted") return "not reached (sort uncertain)";
  return "not run";
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
