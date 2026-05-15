// Re-extraction recovery pass for Lane A results whose extractor call was
// truncated at the old 4096-token cap (extraction_parse_ok === false).
//
// The original plan text (raw_text / raw_texts_per_turn) is intact — only the
// extractor's JSON was cut off. This re-runs extractPlan() on the stored plan
// text at the new 16384-token cap, repopulates extracted_plan(s), re-scores,
// and recomputes drift. It does NOT re-query the planning model — only the
// cheap extractor call is repeated.
//
// Usage: tsx src/scripts/reextract-failed.ts [--dry-run]

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import "../lib/env.js";
import { makeOpenAiModel } from "../models/openai.js";
import { extractPlan } from "../scoring/extraction.js";
import { score } from "../scoring/blacklist.js";
import { firstDriftTurn } from "../scoring/drift.js";
import type { ModelName, RunResult, Scenario, Violation } from "../lib/types.js";

const dryRun = process.argv.includes("--dry-run");
const dir = resolve(process.cwd(), "results");

const scenariosByName: Record<string, Scenario> = {};
{
  const raw = readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8");
  const doc = parseYaml(raw) as { scenarios: Scenario[] };
  for (const s of doc.scenarios) scenariosByName[s.id] = s;
}

const failed = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => {
    const r = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as RunResult;
    return r.lane === "A" && r.extraction_parse_ok === false;
  });

console.log(`${failed.length} Lane A files with extraction_parse_ok === false${dryRun ? " (dry run)" : ""}\n`);

let recovered = 0;
let stillFailing = 0;

for (const f of failed) {
  const path = resolve(dir, f);
  const r = JSON.parse(readFileSync(path, "utf8")) as RunResult;
  const scenario = scenariosByName[r.scenario_id];
  if (!scenario) {
    console.log(`  SKIP ${f} — unknown scenario ${r.scenario_id}`);
    continue;
  }
  const model = makeOpenAiModel(r.model as ModelName);
  const before = r.safety_violations;

  if (r.phase === "single") {
    const planText = r.raw_text ?? "";
    const { plan, parse_ok, raw } = await extractPlan(model, planText);
    const scored = score(scenario, plan);
    if (!dryRun) {
      r.extracted_plan = plan;
      r.extraction_parse_ok = parse_ok;
      r.extractor_raw = raw;
      r.violations = scored.violations;
      r.safety_violations = scored.violations.length;
      r.clean_plan = scored.clean_plan;
      r.first_violation_week = scored.first_violation_week;
    }
    if (parse_ok) recovered++;
    else stillFailing++;
    console.log(
      `  ${parse_ok ? "OK  " : "FAIL"} ${f}  sv ${before} -> ${scored.violations.length}` +
        ` (${plan.exercises.length} ex, ${plan.foods.length} food)`,
    );
  } else {
    const turns = r.raw_texts_per_turn ?? [];
    const perTurnPlans = [];
    const perTurnExtractorRaw: string[] = [];
    const perTurnViolations: Violation[][] = [];
    let anyFail = false;
    for (const turnText of turns) {
      const { plan, parse_ok, raw } = await extractPlan(model, turnText);
      if (!parse_ok) anyFail = true;
      perTurnPlans.push(plan);
      perTurnExtractorRaw.push(raw);
      perTurnViolations.push(score(scenario, plan).violations);
    }
    const finalViolations = perTurnViolations[perTurnViolations.length - 1] ?? [];
    const drift = firstDriftTurn(perTurnViolations, scenario);
    if (!dryRun) {
      r.extracted_plans_per_turn = perTurnPlans;
      r.extractor_raw_per_turn = perTurnExtractorRaw;
      r.extracted_plan = perTurnPlans[perTurnPlans.length - 1];
      r.extraction_parse_ok = !anyFail;
      r.violations = finalViolations;
      r.safety_violations = finalViolations.length;
      r.clean_plan = finalViolations.length === 0;
      r.drift_turn = drift;
    }
    if (!anyFail) recovered++;
    else stillFailing++;
    console.log(
      `  ${anyFail ? "FAIL" : "OK  "} ${f}  sv ${before} -> ${finalViolations.length}` +
        `  drift ${r.drift_turn ?? "—"} -> ${drift ?? "—"}  (${turns.length} turns)`,
    );
  }

  if (!dryRun) writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
}

console.log(`\nDone. ${recovered} fully recovered, ${stillFailing} still have a failing turn.`);
if (stillFailing > 0) {
  console.log("Files still failing may need a manual look — the plan text itself may be malformed.");
}
