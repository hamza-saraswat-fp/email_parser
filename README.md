# email_parser

Reads service-request emails that work-order portals (ServiceChannel, Corrigo, H-E-B My Facility, FEXA, ServicePower, ...) send to a FieldPulse customer, and turns each one into a universal service-request record that a later step creates in FieldPulse.

```
Portal --> customer's mailbox --(auto-forward)--> AgentMail inbox --> this service
                                                                      received -> cleaned -> classified -> extracted -> checked
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
```

Real emails: in Gmail open the message, "Show original", "Download original", save as `fixtures/emails/<name>.eml`. That folder is gitignored (the repo is public).

## Environment

| Variable | What |
|---|---|
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Model calls (OpenAI-compatible), same as the support agent |
| `AGENTMAIL_API_KEY` | AgentMail; inboxes live on the verified `agent.fieldpulse.com` domain |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Shared FieldPulse Supabase project; tables are prefixed `parser_` |
| `PARSER_INBOX_IDS` | Comma-separated inbox ids to subscribe to; each must have a `parser_customers` row |
| `PORT` | HTTP port (default 3000) |

## Database

Apply `supabase/migrations/001_parser.sql` once (SQL editor or Supabase MCP). It is idempotent and seeds three customers: `dev`, `demo`, `solis`.

## Inboxes

```bash
npm run create-inbox -- parser-dev "Email parser (dev)"
npm run send-fixture -- fixtures/emails/sample-servicechannel.eml     # pushes a fixture through AgentMail
```

## Layout

- `src/email/listener.ts` -- AgentMail WebSocket intake (copied from the support agent)
- `src/email/clean.ts` -- HTML to plain text
- `src/pipeline/` -- `run.ts` orchestrates; `classify.ts`, `extract.ts`, `check.ts` are the steps
- `src/schema/record.ts` -- the universal record (zod)
- `src/db/` -- Supabase store and readers
- `src/server.ts` -- `/api/runs`, `/api/runs/:id`, serves `frontend/dist`
- `frontend/` -- runs list and run detail (steps, record, original email)
- `scripts/` -- `replay`, `create-inbox`, `send-fixture`
