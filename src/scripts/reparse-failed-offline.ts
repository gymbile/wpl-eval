// Offline recovery pass — re-parses the persisted `extractor_raw` /
// `extractor_raw_per_turn` for files whose extraction_parse_ok is still false,
// using the current (slightly more lenient) Zod schema. NO API calls.
//
// Catches the residual category of failures the API re-extraction couldn't
// fix: extractor JSON that parses fine but tripped a strict schema (e.g.
// `intensities[].level: null`). Now that we persist the verbatim extractor
// output, any future schema relaxation can be replayed for free.
//
// Usage: tsx src/scripts/reparse-failed-offline.ts [--dry-run]

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { score } from "../scoring/blacklist.js";
import { firstDriftTurn } from "../scoring/drift.js";
import type { ExtractedPlan, RunResult, Scenario, Violation } from "../lib/types.js";

const dryRun = process.argv.includes("--dry-run");
const dir = resolve(process.cwd(), "results");

const scenariosByName: Record<string, Scenario> = {};
{
  const raw = readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8");
  const doc = parseYaml(raw) as { scenarios: Scenario[] };
  for (const s of doc.scenarios) scenariosByName[s.id] = s;
}

// Same schema as src/scoring/extraction.ts — kept in sync deliberately so
// offline re-parse uses identical semantics to live extraction.
const ExtractedPlanSchema = z.object({
  exercises: z.array(z.object({ name: z.string(), week: z.number().nullable().optional() })).default([]),
  foods: z.array(z.object({ name: z.string(), context: z.string().nullable().optional() })).default([]),
  intensities: z
    .array(z.object({ domain: z.string(), level: z.union([z.string(), z.number()]).nullable() }))
    .default([]),
  notes: z.array(z.string()).default([]),
});

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1]!.trim();
  return text.trim();
}

function tryParse(raw: string): { plan: ExtractedPlan | null; ok: boolean } {
  try {
    const j = JSON.parse(stripCodeFence(raw));
    const plan = ExtractedPlanSchema.parse(j) as ExtractedPlan;
    return { plan, ok: true };
  } catch {
    return { plan: null, ok: false };
  }
}

const failed = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => {
    const r = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as RunResult;
    return r.lane === "A" && r.extraction_parse_ok === false;
  });

console.log(`${failed.length} files to re-parse offline${dryRun ? " (dry run)" : ""}\n`);

let recovered = 0;
let stillFailing = 0;

for (const f of failed) {
  const path = resolve(dir, f);
  const r = JSON.parse(readFileSync(path, "utf8")) as RunResult;
  const scenario = scenariosByName[r.scenario_id];
  if (!scenario) {
    console.log(`  SKIP ${f} — unknown scenario`);
    continue;
  }
  const before = r.safety_violations;

  if (r.phase === "single") {
    const raw = r.extractor_raw ?? "";
    if (!raw) {
      console.log(`  SKIP ${f} — no extractor_raw stored`);
      continue;
    }
    const { plan, ok } = tryParse(raw);
    if (!ok || !plan) {
      stillFailing++;
      console.log(`  FAIL ${f}  (JSON or schema unrecoverable)`);
      continue;
    }
    const scored = score(scenario, plan);
    if (!dryRun) {
      r.extracted_plan = plan;
      r.extraction_parse_ok = true;
      r.violations = scored.violations;
      r.safety_violations = scored.violations.length;
      r.clean_plan = scored.clean_plan;
      r.first_violation_week = scored.first_violation_week;
      writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
    }
    recovered++;
    console.log(
      `  OK   ${f}  sv ${before} -> ${scored.violations.length} (${plan.exercises.length} ex, ${plan.foods.length} food)`,
    );
  } else {
    const raws = r.extractor_raw_per_turn ?? [];
    if (raws.length === 0) {
      console.log(`  SKIP ${f} — no extractor_raw_per_turn stored`);
      continue;
    }
    const perTurnPlans: ExtractedPlan[] = [];
    const perTurnViolations: Violation[][] = [];
    let anyFail = false;
    for (const turnRaw of raws) {
      const { plan, ok } = tryParse(turnRaw);
      if (!ok || !plan) {
        anyFail = true;
        perTurnPlans.push({ exercises: [], foods: [], intensities: [], notes: [] });
        perTurnViolations.push([]);
      } else {
        perTurnPlans.push(plan);
        perTurnViolations.push(score(scenario, plan).violations);
      }
    }
    const finalViolations = perTurnViolations[perTurnViolations.length - 1] ?? [];
    const drift = firstDriftTurn(perTurnViolations, scenario);
    if (!dryRun) {
      r.extracted_plans_per_turn = perTurnPlans;
      r.extracted_plan = perTurnPlans[perTurnPlans.length - 1];
      r.extraction_parse_ok = !anyFail;
      r.violations = finalViolations;
      r.safety_violations = finalViolations.length;
      r.clean_plan = finalViolations.length === 0;
      r.drift_turn = drift;
      writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
    }
    if (!anyFail) recovered++;
    else stillFailing++;
    console.log(
      `  ${anyFail ? "PART" : "OK  "} ${f}  sv ${before} -> ${finalViolations.length}  drift ${r.drift_turn ?? "—"} -> ${drift ?? "—"}`,
    );
  }
}

console.log(`\nDone. ${recovered} fully recovered, ${stillFailing} still partial (genuine JSON-parse errors).`);
