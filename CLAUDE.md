# email_parser

Portal service-request emails in, universal service-request records out. See README.md for how it runs.

## Conventions

- TypeScript strict, ES modules, `async/await`, zod at every boundary (env, model output, record).
- One module per step. `src/pipeline/run.ts` is the only place steps are sequenced.
- Every pipeline step writes a `parser_run_steps` row before the next step starts. A run must never end in `running`.
- Model output is copied verbatim into the record; code only normalizes amounts and dates. Never let a prompt "improve" customer text.
- The record shape lives in `src/schema/record.ts`. Add fields there first; `extras` catches anything without a slot.
- Migrations are idempotent (`create table if not exists`, `on conflict do nothing`).
- `fixtures/emails/` holds real customer emails and is gitignored. The repo is public: never commit customer data or `.env`.
- Use en-dashes (--), not em-dashes, in user-facing text.

## Out of scope for V1

FieldPulse API calls, customer matching, accept/decline, attachment parsing, Slack, per-customer config UI.
