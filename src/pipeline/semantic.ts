// Step 6: the questions code cannot ask. Jev confirms that the values the
// reader picked mean what the record says they mean. One request, four
// yes/no questions; every probability is stored; any one below the threshold
// sends the run to a person.
import { askJev, type AskJevFn } from "../llm/jev.js";
import type { ServiceRequest } from "../schema/record.js";

export const SEMANTIC_QUESTIONS = {
  description_is_the_problem: "`extracted.description` is the description of the work or problem the contractor must handle, not boilerplate, instructions, legal text, or a signature.",
  address_is_the_site: "`extracted.site_address` is the address of the site where the work happens, not the contractor's, the portal's, or the client's head office.",
  reference_is_the_lookup_number: "`extracted.reference` is the work order / service request / PO number the contractor would use to find this request in the portal.",
  priority_is_the_priority: "`extracted.priority` is the request's priority or response-time level as the portal states it.",
} as const;
export type SemanticQuestionId = keyof typeof SEMANTIC_QUESTIONS;

export interface SemanticResult {
  scores: Record<SemanticQuestionId, number | null>; // null = not asked (field empty)
  failures: string[];
  model: string;
  usage: unknown;
}

function addressLine(r: ServiceRequest): string | null {
  const a = r.site.address;
  const parts = [a.line1, a.line2, a.city, a.state, a.postal_code].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export async function semanticChecks(record: ServiceRequest, body: string, minScore: number, ask: AskJevFn = askJev): Promise<SemanticResult> {
  const extracted = {
    reference: record.reference.primary,
    site_name: record.site.name,
    site_address: addressLine(record),
    description: record.work.description,
    priority: record.priority.raw,
  };
  const present: Record<SemanticQuestionId, boolean> = {
    description_is_the_problem: Boolean(extracted.description),
    address_is_the_site: Boolean(extracted.site_address),
    reference_is_the_lookup_number: Boolean(extracted.reference),
    priority_is_the_priority: Boolean(extracted.priority),
  };
  const questions = Object.fromEntries(
    (Object.keys(SEMANTIC_QUESTIONS) as SemanticQuestionId[])
      .filter((id) => present[id])
      .map((id) => [id, { type: "boolean" as const, instructions: SEMANTIC_QUESTIONS[id] }]),
  );
  const scores: Record<SemanticQuestionId, number | null> = {
    description_is_the_problem: null, address_is_the_site: null, reference_is_the_lookup_number: null, priority_is_the_priority: null,
  };
  if (!Object.keys(questions).length) return { scores, failures: [], model: "none", usage: null };

  const { answers, model, usage } = await ask({ email: body.slice(0, 12_000), extracted }, questions);
  const failures: string[] = [];
  for (const id of Object.keys(questions) as SemanticQuestionId[]) {
    const a = answers[id];
    if (a?.type !== "boolean") throw new Error(`semantic: missing answer for ${id}`);
    scores[id] = a.boolean;
    if (a.boolean < minScore) failures.push(`${id}: ${a.boolean.toFixed(2)} (min ${minScore})`);
  }
  return { scores, failures, model, usage };
}
