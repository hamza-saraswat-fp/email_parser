// Golden tests: replay every email that has an expected file and compare the
// core fields. Run before deploying any prompt, model, threshold or Jev
// criteria change. Exits non-zero on any mismatch.
//
//   npm run eval
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { processInbound } from "../src/pipeline/run.js";
import { MemoryStore } from "../src/pipeline/memory-store.js";
import { DEFAULT_REQUIRED_FIELDS } from "../src/schema/record.js";
import { verifyRecord } from "../src/pipeline/verify.js";
import { cleanEmail, focusBody } from "../src/email/clean.js";
import { emlToInbound } from "./replay.js";
import type { Customer } from "../src/pipeline/types.js";

const EXPECTED_DIR = "fixtures/expected";
const EMAIL_DIR = "fixtures/emails";
const customer: Customer = { id: "dev", name: "dev", inbox_id: "parser_test@agentmail.to", required_fields: DEFAULT_REQUIRED_FIELDS };

const get = (obj: unknown, path: string): unknown => path.split(".").reduce<any>((a, k) => (a == null ? undefined : a[k]), obj);
const normPara = (v: unknown) =>
  typeof v === "string"
    ? v.split(/\n{2,}/).map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean).sort()
    : v;
// The description is compared as a set of normalized paragraphs: order and
// punctuation around a paragraph are not meaningful; its words are.
const same = (k: string, a: unknown, b: unknown) =>
  k === "work.description" ? JSON.stringify(normPara(a)) === JSON.stringify(normPara(b)) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

let mismatches = 0;
let compared = 0;
for (const file of (await readdir(EXPECTED_DIR)).filter((f) => f.endsWith(".json")).sort()) {
  const expected = JSON.parse(await readFile(join(EXPECTED_DIR, file), "utf8"));
  const emlPath = join(EMAIL_DIR, basename(file, ".json") + ".eml");
  const email = await emlToInbound(emlPath);
  const store = new MemoryStore();
  const summary = await processInbound(email, customer, store, { log: () => {} });
  console.log(`\n### ${file}`);
  const rows: Array<[string, unknown, unknown]> = [
    ["status", expected.status, summary?.status],
    ["email_type", expected.email_type, summary?.email_type],
    ["portal", expected.portal, summary?.portal],
  ];
  if (expected.record) {
    for (const [k, v] of Object.entries(expected.record)) rows.push([k, v, k === "deadlines" ? summary?.record?.deadlines : get(summary?.record, k)]);
  }
  for (const [k, exp, got] of rows) {
    compared++;
    if (!same(k, exp, got)) {
      mismatches++;
      console.log(`  MISMATCH ${k}\n     expected: ${JSON.stringify(exp)}\n     got:      ${JSON.stringify(got)}`);
    }
  }
  // The checker must accept a faithful record: zero verify failures on the
  // record this run produced, when the run reached a record at all.
  if (summary?.record) {
    const { body } = cleanEmail({ text: email.text, html: email.html });
    const failures = verifyRecord(summary.record, focusBody(body), email.subject, email.received_at);
    compared++;
    if (failures.length) { mismatches++; console.log(`  VERIFY failures: ${JSON.stringify(failures)}`); }
  }
  const failed = summary ? [...summary.checks.sort, ...summary.checks.verify, ...summary.checks.semantic, ...summary.checks.required] : [];
  console.log(`  ${rows.length} fields, checks failed: ${failed.length ? failed.join("; ") : "none"}`);
}
console.log(`\n${mismatches === 0 ? "PASS" : "FAIL"}: ${mismatches} mismatch(es) in ${compared} comparisons`);
process.exit(mismatches === 0 ? 0 : 1);
