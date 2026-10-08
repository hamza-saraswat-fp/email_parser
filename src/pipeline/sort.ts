// Step 3: sort the email with Jev. One request, three questions, answered in
// parallel: what kind of email, which portal, and a yes/no on whether it
// dispatches new work. The gate (gate.ts) turns the probabilities into a
// decision; this module only asks.
import { askJev, type AskJevFn, type JevQuestion } from "../llm/jev.js";
import { EMAIL_TYPES, PORTALS, type EmailType, type Portal } from "../schema/record.js";

export interface SortInput {
  from: string | null;
  subject: string | null;
  body: string;
  portalHint: Portal | null;
}

export interface SortResult {
  email_type: EmailType;
  email_type_confidence: number;
  email_type_probabilities: Record<string, number>;
  portal: Portal;
  portal_confidence: number;
  portal_probabilities: Record<string, number>;
  dispatches_new_work: number;
  model: string;
  usage: unknown;
}

// Definitions carried over from the Haiku prompt, in Jev's object form so each
// option says what it is and what it is not.
export const EMAIL_TYPE_CRITERIA: Record<EmailType, Record<string, unknown>> = {
  new_request: {
    what: "A NEW service request / work order being dispatched or assigned to the contractor. It describes a site and a problem to fix. Accept/decline buttons or links are typical.",
    not_for: "Anything about a request the contractor already received.",
  },
  update: {
    what: "A change to a request already sent: reassignment, updated details, status change, approval, note added, proposal response.",
    not_for: "The first notice of a request, or a bare nudge with no new information.",
  },
  cancellation: {
    what: "The request is cancelled, declined, closed, recalled, or withdrawn.",
    not_for: "A request that is still open.",
  },
  reminder: {
    what: "A nudge about an existing request with no new work: no response yet, acceptance overdue, check-in reminder, escalation.",
    not_for: "An email that contains the details of new work.",
  },
  other: {
    what: "Anything else: invoices, payment notices, newsletters, system notices, spam, unrelated mail.",
    not_for: "Any email about a specific work order.",
  },
};

export const PORTAL_CRITERIA: Record<Portal, string> = {
  servicechannel: "ServiceChannel (also sends from scalert.com): 'New Service Request', Tracking Number, NTE, Trade, Accept/Decline buttons",
  corrigo: "Corrigo / CorrigoPro: 'WORK ORDER #', 'DO NOT EXCEED', Accept/Reject By, On-Site By",
  heb: "H-E-B My Facility (Salesforce): 'Work order request #WO-', Location Number, Issue Type, heb.my.salesforce.com link",
  fexa: "FEXA",
  servicepower: "ServicePower",
  other: "Any other system, or no portal at all",
};

export function buildSortQuestions(input: SortInput): Record<string, JevQuestion> {
  const hint = input.portalHint ? ` The sender's domain suggests: ${input.portalHint}.` : "";
  return {
    email_type: {
      type: "choice",
      instructions: "What kind of email is `body` (with `subject` and `from`), for a field-service contractor that receives work orders from portals? If it was forwarded, judge the ORIGINAL message inside the forward.",
      criteria: EMAIL_TYPE_CRITERIA,
    },
    portal: {
      type: "choice",
      instructions: `Which work-order portal produced the original message in \`body\`? Judge by the original sender and the layout, not by who forwarded it.${hint}`,
      criteria: PORTAL_CRITERIA,
    },
    dispatches_new_work: {
      type: "boolean",
      instructions: "`body` assigns or dispatches a NEW work order / service request to the contractor, with a site and a problem to fix.",
      criteria: {
        true: "The email is the first notice of a specific job: it names a location and describes work to be done.",
        false: "The email is a reminder, update, cancellation, invoice, or anything that is not the first notice of a job.",
      },
    },
  };
}

export async function sortEmail(input: SortInput, ask: AskJevFn = askJev): Promise<SortResult> {
  const state = { from: input.from ?? "", subject: input.subject ?? "", body: input.body.slice(0, 12_000) };
  const { answers, model, usage } = await ask(state, buildSortQuestions(input));
  const et = answers.email_type;
  const po = answers.portal;
  const dn = answers.dispatches_new_work;
  if (et?.type !== "choice" || po?.type !== "choice" || dn?.type !== "boolean") {
    throw new Error("sort: unexpected answer shapes from Jev");
  }
  if (!(EMAIL_TYPES as readonly string[]).includes(et.choice)) throw new Error(`sort: off-list email_type ${et.choice}`);
  if (!(PORTALS as readonly string[]).includes(po.choice)) throw new Error(`sort: off-list portal ${po.choice}`);
  return {
    email_type: et.choice as EmailType,
    email_type_confidence: et.confidence,
    email_type_probabilities: et.probabilities,
    portal: po.choice as Portal,
    portal_confidence: po.confidence,
    portal_probabilities: po.probabilities,
    dispatches_new_work: dn.boolean,
    model,
    usage,
  };
}
