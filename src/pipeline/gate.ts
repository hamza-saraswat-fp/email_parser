// The deterministic decision after sorting. Jev's probabilities come in; one
// of three outcomes goes out. Nothing here guesses: an uncertain sort is a
// person's call.
import type { SortResult } from "./sort.js";

export type GateDecision =
  | { outcome: "continue" }
  | { outcome: "skip"; reason: string }
  | { outcome: "review"; reason: string };

export function gate(sort: SortResult, minConfidence: number): GateDecision {
  const confident = sort.email_type_confidence >= minConfidence;
  if (sort.email_type === "new_request") {
    if (confident && sort.dispatches_new_work >= minConfidence) return { outcome: "continue" };
    return {
      outcome: "review",
      reason: `sort_uncertain: new_request at ${sort.email_type_confidence.toFixed(2)}, dispatches_new_work ${sort.dispatches_new_work.toFixed(2)} (min ${minConfidence})`,
    };
  }
  if (confident) return { outcome: "skip", reason: `${sort.email_type} at ${sort.email_type_confidence.toFixed(2)}` };
  return {
    outcome: "review",
    reason: `sort_uncertain: ${sort.email_type} at ${sort.email_type_confidence.toFixed(2)} (min ${minConfidence})`,
  };
}
