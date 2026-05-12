// Stratified spot-check of Lane A extractor accuracy.
//
// PLAN.md required manual review of 10-15% of Lane A scoring decisions
// before publishing. This script picks a deterministic stratified sample
// across (model, scenario) pairs, prints raw_text + extracted_plan
// side-by-side for human inspection, and writes the audit data to a
// markdown file we can scan offline.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RunResult } from "../lib/types.js";

const RESULTS_DIR = resolve(process.cwd(), "results");
const OUT_PATH = resolve(process.cwd(), "../narratives/extraction-audit.md");

const all = readdirSync(RESULTS_DIR)
  .filter((f) => f.includes("__A__single") && f.endsWith(".json") && !f.includes("+"))
  .map((f) => JSON.parse(readFileSync(resolve(RESULTS_DIR, f), "utf8")) as RunResult)
  .filter((r) => !r.error && r.raw_text && r.extracted_plan);

// Stratify: pick 3 per locked model (12 total)
const byModel: Record<string, RunResult[]> = {};
for (const r of all) {
  if (!byModel[r.model]) byModel[r.model] = [];
  byModel[r.model]!.push(r);
}

const sample: RunResult[] = [];
const order = ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-5-nano"];
for (const m of order) {
  const rs = byModel[m] ?? [];
  // Deterministic selection: pick scenarios with violations, scenarios without,
  // and one in between, so the auditor sees both "should hit" and "clean" cases.
  const withViolations = rs.filter((r) => r.safety_violations > 0).sort((a, b) => b.safety_violations - a.safety_violations);
  const clean = rs.filter((r) => r.safety_violations === 0);
  if (withViolations[0]) sample.push(withViolations[0]); // worst case
  if (withViolations[1]) sample.push(withViolations[1]);
  if (clean[0]) sample.push(clean[0]); // clean case
}

const lines: string[] = [];
lines.push("# Lane A Extraction Audit");
lines.push("");
lines.push(
  `Stratified sample of ${sample.length} Lane A single-turn runs. For each, compare the model's verbatim raw output against what the deterministic extractor pulled. Flag any **false negatives** (blacklisted item in raw_text that didn't make it into extracted_plan.exercises) — those would be missed safety hits.`,
);
lines.push("");
lines.push(
  "Auditor's annotation goes in the `### Audit notes` section per case. Possible outcomes:",
);
lines.push("- ✓ Clean — no missed items");
lines.push("- ⚠ False negative — raw mentioned `X` (blacklisted), extractor didn't pull it");
lines.push("- ⚠ False positive — extractor pulled `X`, but raw_text didn't actually prescribe it");
lines.push("- ⚠ Ambiguous — raw is unclear whether the item was prescribed (e.g. shopping list vs programme)");
lines.push("");

for (const r of sample) {
  lines.push(`## ${r.model} / ${r.scenario_id} — ${r.safety_violations} flagged violation(s)`);
  lines.push("");
  lines.push(`**Source:** \`results/${r.model}__${r.scenario_id}__A__single.json\``);
  lines.push("");
  lines.push(`**Flagged violations (${r.violations.length}):**`);
  for (const v of r.violations.slice(0, 10)) {
    lines.push(`- [${v.kind}] \`${v.item}\`${v.week ? ` week ${v.week}` : ""}${v.detail ? ` — ${v.detail}` : ""}`);
  }
  if (r.violations.length > 10) lines.push(`- _(and ${r.violations.length - 10} more)_`);
  lines.push("");
  lines.push(`**Extracted exercises (first 40 of ${r.extracted_plan?.exercises.length ?? 0}):**`);
  lines.push("```");
  for (const e of r.extracted_plan!.exercises.slice(0, 40)) {
    lines.push(`  week ${e.week ?? "?"}: ${e.name}`);
  }
  if ((r.extracted_plan?.exercises.length ?? 0) > 40) lines.push(`  ...and ${r.extracted_plan!.exercises.length - 40} more`);
  lines.push("```");
  if (r.extracted_plan && r.extracted_plan.foods.length > 0) {
    lines.push("");
    lines.push(`**Extracted foods (${r.extracted_plan.foods.length}):**`);
    lines.push("```");
    for (const f of r.extracted_plan.foods.slice(0, 25)) {
      lines.push(`  ${f.name}${f.context ? ` (${f.context})` : ""}`);
    }
    if (r.extracted_plan.foods.length > 25) lines.push(`  ...and ${r.extracted_plan.foods.length - 25} more`);
    lines.push("```");
  }
  if (r.extracted_plan && r.extracted_plan.intensities.length > 0) {
    lines.push("");
    lines.push(`**Extracted intensities (${r.extracted_plan.intensities.length}):**`);
    lines.push("```");
    for (const i of r.extracted_plan.intensities.slice(0, 12)) {
      lines.push(`  ${i.domain}: ${i.level}`);
    }
    if (r.extracted_plan.intensities.length > 12) lines.push(`  ...and ${r.extracted_plan.intensities.length - 12} more`);
    lines.push("```");
  }
  lines.push("");
  lines.push("**Raw text (full, for cross-check):**");
  lines.push("");
  lines.push("<details><summary>Click to expand</summary>");
  lines.push("");
  lines.push("```");
  lines.push(r.raw_text!.slice(0, 8000));
  if ((r.raw_text?.length ?? 0) > 8000) lines.push(`\n...(truncated at 8000 chars; full text in results JSON)`);
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push("### Audit notes");
  lines.push("");
  lines.push("_(verdict + notes here)_");
  lines.push("");
  lines.push("---");
  lines.push("");
}

writeFileSync(OUT_PATH, lines.join("\n"));
console.log(`Wrote audit to ${OUT_PATH}`);
console.log(`Sample size: ${sample.length} (stratified across ${order.length} models)`);
