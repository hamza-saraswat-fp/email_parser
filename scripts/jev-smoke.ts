// Connection test with made-up text only. Prints the raw answer shapes so the
// field names used in src/llm/jev.ts come from the wire, not memory.
import { config } from "../src/config.js";

const state = {
  from: "dispatch@example-portal.com",
  subject: "New Service Request #123456 | Store 42 | Lighting",
  body: "Your company has received a service request #123456.\nCustomer: ACME MARKETS Store 42\nAddress: 1 Main St, Springfield IL 62701\nProblem: Light bulb is out in the back room.\nPriority: 2 business days\nNTE: 500.00",
};
const questions = {
  email_type: {
    type: "choice",
    instructions: "What kind of email is this, for a field-service contractor?",
    criteria: {
      new_request: "A new work order or service request assigned to the contractor",
      update: "A change to a request already sent",
      cancellation: "The request is cancelled or recalled",
      reminder: "A nudge about an existing request, no new work",
      other: "Anything else",
    },
  },
  dispatches_new_work: {
    type: "boolean",
    instructions: "This email assigns or dispatches a NEW work order / service request to the contractor, with a site and a problem to fix.",
  },
};
const res = await fetch("https://ai-gateway.vercel.sh/v1/evaluate", {
  method: "POST",
  headers: { Authorization: `Bearer ${config.AI_GATEWAY_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: config.JEV_MODEL, state, questions, providerOptions: { gateway: { zeroDataRetention: true } } }),
});
console.log("status:", res.status);
const text = await res.text();
console.log(text.slice(0, 1500));
