# email_parser

Reads service-request emails that work-order portals (ServiceChannel, Corrigo, H-E-B My Facility, FEXA, ServicePower, ...) send to a FieldPulse customer, and turns each one into a universal service-request record that a later step creates in FieldPulse.

```
Portal --> customer's mailbox --(auto-forward)--> AgentMail inbox --> this service
   received -> cleaned -> sorted (Jev) -> read (Sonnet) -> verified (code) -> semantic (Jev) -> required fields
   -> ready | needs_review -> a person approves -> approved
   every step stored, visible at /runs
```

V1 scope: intake and parsing. Creating the job in FieldPulse is the next piece.

## Run locally

```bash
cp .env.example .env     # fill in keys (see below)
npm install
npm run dev              # backend on :3000 (API + AgentMail listener), frontend on :5173
```

Replay an email without AgentMail or a database:

```bash
npm run replay -- fixtures/emails/sample-servicechannel.eml
npm run replay -- fixtures/emails/*.eml --db     # also writes runs to Supabase as customer "dev"
npm run replay -- fixtures/emails/*.eml --extract-model anthropic/claude-sonnet-5.5 --out tmp/models/try1
npm run compare -- tmp/models/baseline tmp/models/try1   # field-by-field diff of two replay outputs
npm run eval                                              # golden tests: core fields vs fixtures/expected/*.json
npm run jev-smoke                                         # connection test for Jev, made-up text only
```

## How a run is judged

The models propose; code decides. A record is `ready` only when: Jev sorted it as a new request above the confidence floor, every value the reader produced appears in the email text (verify step), Jev agreed each key value means what the record says (semantic step), and the required fields are present. Anything else is `needs_review`. A person then approves or rejects from the run page; `approved` is what the FieldPulse step will consume.

Real emails: in Gmail open the message, "Show original", "Download original", save as `fixtures/emails/<name>.eml`. That folder is gitignored (the repo is public).

## Environment

| Variable | What |
|---|---|
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Model calls (OpenAI-compatible), same as the support agent |
| `OPENROUTER_MODEL_EXTRACT` | The reader's model. Unset = `OPENROUTER_MODEL`. |
| `AI_GATEWAY_API_KEY`, `JEV_MODEL` | Jev (TypeSafe) through the Vercel AI Gateway: sorting and semantic checks, zero data retention requested. |
| `JEV_SORT_MIN_CONFIDENCE` | Below this, a sort result goes to a person instead of being acted on (default 0.7). |
| `JEV_CHECK_MIN` | Below this, a semantic check fails and the run goes to a person (default 0.7). |
| `AGENTMAIL_API_KEY` | AgentMail; inboxes live on the verified `agent.fieldpulse.com` domain |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Shared FieldPulse Supabase project; tables are prefixed `parser_` |
| `PARSER_INBOX_IDS` | Comma-separated inbox ids to subscribe to; each must have a `parser_customers` row |
| `PORT` | HTTP port (default 3000) |
| `FP_AUTH_URL` | Universal Auth project URL. When set, every `/api` call needs a FieldPulse-issued token. Unset = open API (local only). |
| `VITE_FP_AUTH_URL`, `VITE_FP_AUTH_PUBLISHABLE_KEY` | Same project, for the browser. Baked in at build time. Unset = no sign-in screen (local only). |

## Sign-in

Production uses [Universal Auth](https://github.com/hamza-saraswat-fp/Universal_auth): anyone with a FieldPulse Google account can open the page, and the API verifies the token on every call. The production domain must be on the auth project's redirect allow-list (`https://<domain>/**`).

## Database

Apply the migrations in order (`supabase/migrations/001_parser.sql`, `002_review.sql`) in the SQL editor. They are idempotent. 001 seeds three customers: `dev`, `demo`, `solis`.

## Inboxes

```bash
npm run create-inbox -- parser-dev "Email parser (dev)"
npm run send-fixture -- fixtures/emails/sample-servicechannel.eml     # pushes a fixture through AgentMail
```

## Layout

- `src/email/listener.ts` -- AgentMail WebSocket intake (copied from the support agent)
- `src/email/clean.ts` -- HTML to plain text
- `src/pipeline/` -- `run.ts` orchestrates; `sort.ts` + `gate.ts`, `extract.ts`, `verify.ts`, `semantic.ts`, `check.ts` are the steps
- `src/llm/` -- `openrouter.ts` (the reader), `jev.ts` (sorting and checks)
- `src/schema/record.ts` -- the universal record (zod)
- `src/db/` -- Supabase store and readers
- `src/server.ts` -- `/api/runs`, `/api/runs/:id`, serves `frontend/dist`
- `frontend/` -- runs list and run detail (steps, record, original email)
- `scripts/` -- `replay`, `eval`, `compare-records`, `create-inbox`, `send-fixture`, `jev-smoke`, `smoke-live`
