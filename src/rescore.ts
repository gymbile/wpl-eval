// One-off: re-score every results/*.json against the current blacklist
// matcher, using the stored `extracted_plan`. No LLM calls — the extraction
// is already done. Updates: safety_violations, clean_plan, first_violation_week,
// violations[]. Preserves everything else. Useful after a scorer bug fix
// (e.g. the intensity-threshold check landed after the initial sweep).

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { score } from "./scoring/blacklist.js";
import type { RunResult, Scenario } from "./lib/types.js";

const dir = resolve(process.cwd(), "results");
const scenariosByName: Record<string, Scenario> = {};
{
  const raw = readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8");
  const doc = parseYaml(raw) as { scenarios: Scenario[] };
  for (const s of doc.scenarios) scenariosByName[s.id] = s;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
let updated = 0;
let unchanged = 0;
const summary: Array<{ file: string; before: number; after: number }> = [];

for (const f of files) {
  const path = resolve(dir, f);
  const r = JSON.parse(readFileSync(path, "utf8")) as RunResult;
  const scenario = scenariosByName[r.scenario_id];
  if (!scenario) continue;
  if (!r.extracted_plan) continue;

  const scored = score(scenario, r.extracted_plan);
  const before = r.safety_violations;
  const after = scored.violations.length;

  if (
    before === after &&
    r.first_violation_week === scored.first_violation_week &&
    JSON.stringify(r.violations) === JSON.stringify(scored.violations)
  ) {
    unchanged++;
    continue;
  }

  r.safety_violations = after;
  r.violations = scored.violations;
  r.first_violation_week = scored.first_violation_week;
  // clean_plan logic depends on lane:
  //   Lane A: clean_plan = violations === 0
  //   Lane B: clean_plan = wpl_valid && violations === 0
  if (r.lane === "A") {
    r.clean_plan = after === 0 && !r.refusal;
  } else {
    r.clean_plan = !!r.wpl_valid && after === 0 && !r.refusal;
  }
  writeFileSync(path, JSON.stringify(r, null, 2));
  summary.push({ file: f, before, after });
  updated++;
}

console.log(`Re-scored ${files.length} files: ${updated} updated, ${unchanged} unchanged.`);
if (summary.length) {
  console.log("\nChanges:");
  for (const s of summary.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))) {
    console.log(`  ${s.file.replace(".json", "").padEnd(60)} ${s.before} → ${s.after}`);
  }
}
