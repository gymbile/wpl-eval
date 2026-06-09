// Re-derive violations on v0.6 short-plan result files without re-running
// the LLM. Reads each `+v0.6-shortplans__*` file's stored `wpl_json` and
// `raw_text`, re-runs the blacklist scorer + scoreShortPlan, writes back.
//
// Use after fixing scorer rules in src/scoring/short-plan.ts so the new
// numbers are derived from the same LLM outputs the original sweep
// produced — no fresh inference.
//
// Touches only files tagged `v0.6-shortplans`. Other result files
// (v0.5 OpenAI, v0.6 Anthropic on the long-plan corpus) are owned by
// rescore-lane-b.ts and untouched here.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { score } from "../scoring/blacklist.js";
import { scoreShortPlan } from "../scoring/short-plan.js";
import type { ExtractedPlan, RunResult, Scenario } from "../lib/types.js";

const RESULTS_DIR = resolve(process.cwd(), "results");
const SCENARIOS_PATH = resolve(process.cwd(), "scenarios/scenarios.yaml");

const scenarios: Record<string, Scenario> = {};
{
  const doc = parseYaml(readFileSync(SCENARIOS_PATH, "utf8")) as { scenarios: Scenario[] };
  for (const s of doc.scenarios) scenarios[s.id] = s;
}

const files = readdirSync(RESULTS_DIR).filter(
  (f) => f.includes("+v0.6-shortplans__") && f.endsWith(".json"),
);

let updated = 0;
let unchanged = 0;
const summary: Array<{ file: string; before: string; after: string }> = [];

for (const f of files) {
  const path = resolve(RESULTS_DIR, f);
  const r = JSON.parse(readFileSync(path, "utf8")) as RunResult;
  if (r.error || r.refusal) continue;
  const scenario = scenarios[r.scenario_id];
  if (!scenario) {
    console.warn(`  WARN: no scenario for ${r.scenario_id} (${f})`);
    continue;
  }
  const beforeViols = r.safety_violations;
  const beforeKinds = (r.violations ?? []).map((v) => v.kind).sort().join(",");

  // Lane A: re-run blacklist on stored extracted_plan + short-plan rules
  // on stored raw_text (text-channel only).
  if (r.lane === "A") {
    const extracted = (r.extracted_plan ?? {
      exercises: [],
      foods: [],
      intensities: [],
      notes: [],
    }) as ExtractedPlan;
    const blacklisted = score(scenario, extracted);
    const shortPlan = scoreShortPlan(scenario, {
      lane: "A",
      rawText: r.raw_text ?? null,
    });
    r.violations = [...blacklisted.violations, ...shortPlan];
    r.safety_violations = r.violations.length;
    r.clean_plan = r.safety_violations === 0;
    r.first_violation_week = blacklisted.first_violation_week;
  } else if (r.lane === "B") {
    // Lane B: re-run blacklist on stored extracted_plan + short-plan
    // rules on stored wpl_json.
    const extracted = (r.extracted_plan ?? {
      exercises: [],
      foods: [],
      intensities: [],
      notes: [],
    }) as ExtractedPlan;
    const blacklisted = score(scenario, extracted);
    const shortPlan = scoreShortPlan(scenario, {
      lane: "B",
      wplJson: (r.wpl_json ?? null) as Record<string, unknown> | null,
    });
    r.violations = [...blacklisted.violations, ...shortPlan];
    r.safety_violations = r.violations.length;
    r.clean_plan = r.safety_violations === 0;
    r.first_violation_week = blacklisted.first_violation_week;
  }

  const afterViols = r.safety_violations;
  const afterKinds = (r.violations ?? []).map((v) => v.kind).sort().join(",");
  if (beforeViols !== afterViols || beforeKinds !== afterKinds) {
    summary.push({
      file: f,
      before: `viols=${beforeViols} kinds=[${beforeKinds}]`,
      after: `viols=${afterViols} kinds=[${afterKinds}]`,
    });
    updated++;
    writeFileSync(path, JSON.stringify(r, null, 2));
  } else {
    unchanged++;
  }
}

console.log(`Re-scored ${files.length} v0.6 short-plan files: ${updated} changed, ${unchanged} unchanged.`);
if (summary.length && summary.length <= 30) {
  console.log("\nChanges:");
  for (const s of summary) {
    console.log(`  ${s.file.replace(".json", "").padEnd(70)}`);
    console.log(`    ${s.before}`);
    console.log(`    ${s.after}`);
  }
} else if (summary.length) {
  console.log(`\n(${summary.length} files changed — see file contents for detail.)`);
}
