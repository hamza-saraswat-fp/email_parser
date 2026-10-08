// Diff two replay output folders field by field.
//   npm run compare -- tmp/models/sonnet4 tmp/models/haiku55
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error("usage: npm run compare -- <dirA> <dirB>");
  process.exit(1);
}

const IGNORE = new Set(["extraction.model", "extraction.extracted_at", "source.message_id", "source.received_at"]);

function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value)) {
    // Order-insensitive for arrays of label/value pairs.
    out[prefix] = JSON.stringify([...value].map((x) => JSON.stringify(x)).sort());
  } else {
    out[prefix] = value;
  }
  return out;
}

const show = (v: unknown) => (v === undefined ? "(absent)" : typeof v === "string" ? JSON.stringify(v.length > 70 ? v.slice(0, 67) + "..." : v) : JSON.stringify(v));

const filesA = (await readdir(dirA)).filter((f) => f.endsWith(".json")).sort();
let totalFields = 0;
let totalDiffs = 0;
for (const f of filesA) {
  let a: any, b: any;
  try {
    a = JSON.parse(await readFile(join(dirA, f), "utf8"));
    b = JSON.parse(await readFile(join(dirB, f), "utf8"));
  } catch {
    console.log(`\n### ${f}: missing in one folder`);
    continue;
  }
  console.log(`\n### ${f}`);
  const sa = a.summary, sb = b.summary;
  console.log(`status: ${sa.status} vs ${sb.status}   type: ${sa.email_type} vs ${sb.email_type}   portal: ${sa.portal} vs ${sb.portal}`);
  const stepsA = Object.fromEntries((a.steps ?? []).map((s: any) => [s.name, s]));
  const stepsB = Object.fromEntries((b.steps ?? []).map((s: any) => [s.name, s]));
  for (const name of ["classified", "extracted"]) {
    if (stepsA[name] || stepsB[name]) {
      console.log(`${name.padEnd(10)} ${String(stepsA[name]?.duration_ms ?? "-").padStart(6)}ms (${stepsA[name]?.model ?? "-"})  vs  ${String(stepsB[name]?.duration_ms ?? "-").padStart(6)}ms (${stepsB[name]?.model ?? "-"})`);
    }
  }
  if (!a.record || !b.record) {
    console.log(a.record || b.record ? "record present in only one run" : "no record in either run");
    continue;
  }
  const fa = flatten(a.record), fb = flatten(b.record);
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => !IGNORE.has(k)).sort();
  let diffs = 0;
  for (const k of keys) {
    totalFields++;
    if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) {
      diffs++;
      console.log(`  ${k}\n     A: ${show(fa[k])}\n     B: ${show(fb[k])}`);
    }
  }
  totalDiffs += diffs;
  console.log(diffs ? `${diffs} of ${keys.length} fields differ` : `identical (${keys.length} fields)`);
}
console.log(`\nTOTAL: ${totalDiffs} of ${totalFields} fields differ`);
