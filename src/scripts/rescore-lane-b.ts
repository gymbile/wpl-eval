// Re-compile every Lane B result's raw_text through the CURRENTLY installed
// wpl-ai + wpl-validator and refresh:
//   wpl_valid, wpl_schema_valid, compile_errors, validator_errors,
//   extracted_plan, violations, safety_violations, clean_plan, first_violation_week
//
// Use after bumping the bundled validator (e.g. 1.6.6 → 1.6.7) to refresh
// validator-side numbers without spending another dollar on LLM calls. The
// LLM output is fixed — only the compiler/validator interpretation of it changes.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileWplAi } from "@gymbile/wpl-ai";
import { evaluateRules, firingActions } from "@gymbile/wpl-validator";
import { score } from "../scoring/blacklist.js";
import type {
  ClientContext,
  ExtractedPlan,
  RunResult,
  Scenario,
} from "../lib/types.js";

const RESULTS_DIR = resolve(process.cwd(), "results");
const SCENARIOS_PATH = resolve(process.cwd(), "scenarios/scenarios.yaml");

const scenarioDoc = parseYaml(readFileSync(SCENARIOS_PATH, "utf8")) as {
  scenarios: Scenario[];
};
const scenarios: Record<string, Scenario> = {};
for (const s of scenarioDoc.scenarios) scenarios[s.id] = s;

// Mirror of lane-b.ts logic for ClientContext + personalization construction.
function buildClientContext(scenario: Scenario): ClientContext {
  const p = scenario.presenting as Record<string, unknown>;
  const inj = Array.isArray(p["injuries"]) ? (p["injuries"] as string[]) : [];
  const conds = Array.isArray(p["conditions"]) ? (p["conditions"] as string[]) : [];
  return {
    injuries: [...inj, ...conds],
    equipment: Array.isArray(p["equipment"]) ? (p["equipment"] as string[]) : [],
    experience: typeof p["experience"] === "string" ? (p["experience"] as string) : null,
    goals: Array.isArray(p["goals"]) ? (p["goals"] as string[]) : [],
  };
}

function buildPersonalization(scenario: Scenario, ctx: ClientContext): Parameters<typeof evaluateRules>[0] {
  const rules: NonNullable<Parameters<typeof evaluateRules>[0]> = [];
  const inj = ctx.injuries ?? [];
  const eq = ctx.equipment ?? [];
  for (const ex of scenario.blacklist.exercises ?? []) {
    rules.push({
      id: `forbid_${ex}`,
      condition: inj.length
        ? { field: "injuries", op: "contains", value: inj[0] }
        : eq.length
          ? { field: "equipment", op: "contains", value: eq[0] }
          : null,
      actions: [{ type: "forbid_exercise", exercise: ex }],
    });
  }
  return rules;
}

// 2026-06-08: Walkers rewritten to match the real wpl-ai compiled JSON
// shape (`plan.phases[].weeks[].days[].blocks[].activities[]`). The
// previous version assumed top-level `phases[]` and `day.warmup/main/
// cooldown.items[]`, which silently returned empty extractions on
// every Lane B trial after wpl-ai's shape changed. See
// src/lanes/lane-b.ts for the same fix in the live pipeline.
function extractFromWplJson(json: Record<string, unknown>): ExtractedPlan {
  const exercises: ExtractedPlan["exercises"] = [];
  const foods: ExtractedPlan["foods"] = [];
  const intensities: ExtractedPlan["intensities"] = [];
  const notes: ExtractedPlan["notes"] = [];

  const plan =
    typeof json["plan"] === "object" && json["plan"] !== null
      ? (json["plan"] as Record<string, unknown>)
      : json;

  const phases = Array.isArray(plan["phases"]) ? (plan["phases"] as Record<string, unknown>[]) : [];
  let weekCursor = 0;
  for (const phase of phases) {
    const weeks = Array.isArray(phase["weeks"]) ? (phase["weeks"] as Record<string, unknown>[]) : [];
    for (const week of weeks) {
      weekCursor++;
      const days = Array.isArray(week["days"]) ? (week["days"] as Record<string, unknown>[]) : [];
      for (const day of days) {
        const blocks = Array.isArray(day["blocks"]) ? (day["blocks"] as Record<string, unknown>[]) : [];
        for (const block of blocks) {
          const activities = Array.isArray(block["activities"])
            ? (block["activities"] as Record<string, unknown>[])
            : [];
          for (const activity of activities) {
            const ref =
              typeof activity["exercise_ref"] === "string"
                ? (activity["exercise_ref"] as string)
                : null;
            const name =
              typeof activity["name"] === "string" ? (activity["name"] as string) : null;
            const exerciseName = ref ?? name;
            if (exerciseName) exercises.push({ name: exerciseName, week: weekCursor });
            const rpeCandidates: Array<unknown> = [activity["target_rpe"]];
            const presc = activity["prescription"];
            if (presc && typeof presc === "object") {
              rpeCandidates.push((presc as Record<string, unknown>)["target_rpe"]);
              rpeCandidates.push((presc as Record<string, unknown>)["rpe"]);
            }
            for (const r of rpeCandidates) {
              if (typeof r === "number" && Number.isFinite(r)) {
                intensities.push({ domain: "rpe", level: r });
                break;
              }
            }
          }
        }
      }
    }
  }

  return { exercises, foods, intensities, notes };
}

function stripForbidden(
  json: Record<string, unknown>,
  forbidden: Set<string>,
): Record<string, unknown> {
  if (forbidden.size === 0) return json;
  const clone = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  const plan =
    typeof clone["plan"] === "object" && clone["plan"] !== null
      ? (clone["plan"] as Record<string, unknown>)
      : clone;
  const phases = Array.isArray(plan["phases"]) ? (plan["phases"] as Record<string, unknown>[]) : [];
  for (const phase of phases) {
    const weeks = Array.isArray(phase["weeks"]) ? (phase["weeks"] as Record<string, unknown>[]) : [];
    for (const week of weeks) {
      const days = Array.isArray(week["days"]) ? (week["days"] as Record<string, unknown>[]) : [];
      for (const day of days) {
        const blocks = Array.isArray(day["blocks"]) ? (day["blocks"] as Record<string, unknown>[]) : [];
        for (const block of blocks) {
          const activities = Array.isArray(block["activities"])
            ? (block["activities"] as Record<string, unknown>[])
            : [];
          block["activities"] = activities.filter((activity) => {
            const ref =
              typeof activity["exercise_ref"] === "string"
                ? (activity["exercise_ref"] as string)
                : null;
            const name =
              typeof activity["name"] === "string" ? (activity["name"] as string) : null;
            const id = ref ?? name ?? "";
            return !forbidden.has(id);
          });
        }
      }
    }
  }
  return clone;
}

// ---------------------------------------------------------------------------

const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
let updated = 0;
let unchanged = 0;
const summary: Array<{ file: string; before: string; after: string }> = [];

for (const f of files) {
  if (!f.includes("__B__")) continue;
  // Multi-turn rescoring is owned by rescore-multiturn-lateststate.ts
  // which uses latest-valid-turn semantics. This script's final-turn-only
  // logic would otherwise clobber multi-turn results when the final turn
  // is a refusal or a non-DSL message (see V0_6 methodology notes).
  if (f.includes("__multi.")) continue;
  const path = resolve(RESULTS_DIR, f);
  const r = JSON.parse(readFileSync(path, "utf8")) as RunResult;
  if (r.error) continue;
  const scenario = scenarios[r.scenario_id];
  if (!scenario) continue;

  const before = `valid=${r.wpl_valid} schema=${r.wpl_schema_valid} comp=${r.compile_errors} val=${r.validator_errors} viol=${r.safety_violations}`;

  // For multi-turn, re-evaluate per-turn from raw_texts_per_turn (if captured).
  // For single-turn, just re-evaluate the single raw_text.
  if (r.phase === "single" && r.raw_text) {
    refresh(r, scenario, r.raw_text);
  } else if (r.phase === "multi" && r.raw_texts_per_turn?.length) {
    // Re-evaluate final turn only for headline metrics.
    refresh(r, scenario, r.raw_texts_per_turn[r.raw_texts_per_turn.length - 1]!);
  } else if (r.phase === "multi" && r.raw_text) {
    refresh(r, scenario, r.raw_text);
  } else {
    continue;
  }

  const after = `valid=${r.wpl_valid} schema=${r.wpl_schema_valid} comp=${r.compile_errors} val=${r.validator_errors} viol=${r.safety_violations}`;
  if (before !== after) {
    summary.push({ file: f, before, after });
    updated++;
    writeFileSync(path, JSON.stringify(r, null, 2));
  } else {
    unchanged++;
  }
}

console.log(`Re-evaluated ${files.filter((f) => f.includes("__B__")).length} Lane B files: ${updated} updated, ${unchanged} unchanged.`);
if (summary.length) {
  console.log("\nChanges:");
  for (const s of summary) {
    console.log(`  ${s.file.replace(".json", "").padEnd(60)}`);
    console.log(`    ${s.before}`);
    console.log(`    ${s.after}`);
  }
}

function refresh(r: RunResult, scenario: Scenario, text: string): void {
  if (r.refusal) return;

  const stripped = text.replace(/^```[a-zA-Z0-9_-]*\n/, "").replace(/```\s*$/, "").trim();
  const compiled = compileWplAi(stripped);
  if (!compiled.ok) {
    r.wpl_valid = false;
    r.wpl_schema_valid = false;
    r.compile_errors = compiled.errors.length;
    r.validator_errors = 0;
    r.safety_violations = 0;
    r.violations = [];
    r.clean_plan = false;
    r.first_violation_week = null;
    r.wpl_json = undefined;
    r.extracted_plan = { exercises: [], foods: [], intensities: [], notes: [] };
    return;
  }

  const ctx = buildClientContext(scenario);
  const { evaluated } = evaluateRules(buildPersonalization(scenario, ctx), ctx);
  const fired = firingActions(evaluated);
  const forbidden = new Set(
    fired
      .filter((a) => a["type"] === "forbid_exercise" && typeof a["exercise"] === "string")
      .map((a) => a["exercise"] as string),
  );
  const planJson = stripForbidden(compiled.json, forbidden);
  const extracted = extractFromWplJson(planJson);
  const scored = score(scenario, extracted);
  const validatorErrors = compiled.validation.valid ? 0 : (compiled.validation.errors?.length ?? 0);

  r.wpl_valid = true;
  r.wpl_schema_valid = validatorErrors === 0;
  r.compile_errors = 0;
  r.validator_errors = validatorErrors;
  r.safety_violations = scored.violations.length;
  r.violations = scored.violations;
  r.clean_plan = scored.violations.length === 0;
  r.first_violation_week =
    scored.violations.find((v) => typeof v.week === "number")?.week ?? null;
  r.wpl_json = planJson;
  r.extracted_plan = extracted;
}
