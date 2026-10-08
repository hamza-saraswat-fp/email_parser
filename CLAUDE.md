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
- **Models propose; code decides.** The reader's output never reaches `ready` without the verify step (every value found in the email) and the semantic step. Never relax a check to make a run pass; fix the prompt or the criteria, then prove it with `npm run eval`.
- **`npm run eval` before deploying** any change to a prompt, a model, a threshold or Jev criteria. Expected files live in `fixtures/expected/` (gitignored, same data as the emails).

## Out of scope for V1

FieldPulse API calls, customer matching, accept/decline, attachment parsing, Slack, per-customer config UI.
