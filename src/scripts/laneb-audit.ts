// Audit how Lane B achieves its "0 unsafe plans" result.
//
// The headline claim is that across 80 Lane B runs, scored against the
// same blacklist as Lane A, zero safety violations were recorded. This
// script breaks that "0" down into mechanisms:
//
// 1. Re-compile every Lane B raw_text through current wpl-ai.
// 2. Extract exercises BEFORE rule-evaluator stripping (unfiltered) and
//    AFTER stripping (the "served" plan).
// 3. Score both against the scenario blacklist.
// 4. Report:
//    - How many plans had a blacklisted exercise emitted by the LLM
//      (caught by unfiltered scoring)
//    - How many of those were stripped by the rule evaluator before
//      serving (the difference: filtered=0 vs unfiltered>0)
//    - How many plans were "clean by emission" (LLM never produced a
//      blacklisted exercise — credit goes to vocabulary priming + prompt)
//    - Any plans where unfiltered=0 and filtered=0 because compile failed
//      (fail-closed: nothing served)

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileWplAi } from "@gymbile/wpl-ai";
import { evaluateRules, firingActions } from "@gymbile/wpl-validator";
import { score, collides } from "../scoring/blacklist.js";
import type {
  ClientContext,
  ExtractedPlan,
  RunResult,
  Scenario,
} from "../lib/types.js";

const scenarioDoc = parseYaml(
  readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8"),
) as { scenarios: Scenario[] };
const scenarios: Record<string, Scenario> = {};
for (const s of scenarioDoc.scenarios) scenarios[s.id] = s;

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

function extractFromWplJson(json: Record<string, unknown>): ExtractedPlan {
  const exercises: ExtractedPlan["exercises"] = [];
  const phases = Array.isArray(json["phases"]) ? (json["phases"] as Record<string, unknown>[]) : [];
  let weekCursor = 0;
  for (const phase of phases) {
    const weeks = Array.isArray(phase["weeks"]) ? (phase["weeks"] as Record<string, unknown>[]) : [];
    for (const week of weeks) {
      weekCursor++;
      const days = Array.isArray(week["days"]) ? (week["days"] as Record<string, unknown>[]) : [];
      for (const day of days) {
        for (const sec of ["warmup", "main", "cooldown"] as const) {
          const section = day[sec];
          if (!section || typeof section !== "object") continue;
          const items = Array.isArray((section as Record<string, unknown>)["items"])
            ? ((section as Record<string, unknown>)["items"] as Record<string, unknown>[])
            : [];
          for (const item of items) {
            const name = typeof item["exercise"] === "string" ? (item["exercise"] as string) : null;
            if (name) exercises.push({ name, week: weekCursor });
          }
        }
      }
    }
  }
  return { exercises, foods: [], intensities: [], notes: [] };
}

// NOTE (v0.7): this local strip walks the legacy day.warmup/main/cooldown.items[] shape and is stale
// vs the current plan.phases[].weeks[].days[].blocks[].activities[] schema — offline audit helper only,
// NOT the measured pipeline (Lane B uses @gymbile/wpl-validator enforce()). Pre-existing; tracked for a later cleanup.
function isForbidden(name: string, forbidden: ReadonlySet<string>): boolean {
  if (!name) return false;
  for (const bl of forbidden) if (collides(name, bl)) return true;
  return false;
}

function stripForbidden(json: Record<string, unknown>, forbidden: Set<string>): Record<string, unknown> {
  if (forbidden.size === 0) return json;
  const clone = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  const phases = Array.isArray(clone["phases"]) ? (clone["phases"] as Record<string, unknown>[]) : [];
  for (const phase of phases) {
    const weeks = Array.isArray(phase["weeks"]) ? (phase["weeks"] as Record<string, unknown>[]) : [];
    for (const week of weeks) {
      const days = Array.isArray(week["days"]) ? (week["days"] as Record<string, unknown>[]) : [];
      for (const day of days) {
        for (const sec of ["warmup", "main", "cooldown"] as const) {
          const section = day[sec];
          if (!section || typeof section !== "object") continue;
          const items = Array.isArray((section as Record<string, unknown>)["items"])
            ? ((section as Record<string, unknown>)["items"] as Record<string, unknown>[])
            : [];
          (section as Record<string, unknown>)["items"] = items.filter((item) => {
            const name = typeof item["exercise"] === "string" ? (item["exercise"] as string) : "";
            return !isForbidden(name, forbidden);
          });
        }
      }
    }
  }
  return clone;
}

// ---------------------------------------------------------------------------

let compileFailed = 0;
let refusedToGenerate = 0;
let cleanByEmission = 0;   // LLM never emitted a blacklisted exercise
let strippedByEvaluator = 0; // LLM emitted blacklisted, evaluator stripped it
let leakedThrough = 0;      // LLM emitted blacklisted, evaluator missed it
const leaks: Array<{ file: string; viols: string[] }> = [];
const strippedDetails: Array<{ file: string; stripped: string[] }> = [];

const files = readdirSync(resolve(process.cwd(), "results")).filter(
  (f) => f.includes("__B__") && f.endsWith(".json") && !f.includes("+"),
);

for (const f of files) {
  const r = JSON.parse(readFileSync(resolve(process.cwd(), "results", f), "utf8")) as RunResult;
  if (r.error) continue;
  const scenario = scenarios[r.scenario_id];
  if (!scenario) continue;

  if (r.refusal) {
    refusedToGenerate++;
    continue;
  }

  const text = r.raw_texts_per_turn?.[r.raw_texts_per_turn.length - 1] ?? r.raw_text ?? "";
  const compiled = compileWplAi(text);
  if (!compiled.ok) {
    compileFailed++;
    continue;
  }

  const planJson = compiled.json.plan as Record<string, unknown>;
  const ctx = buildClientContext(scenario);
  const { evaluated } = evaluateRules(buildPersonalization(scenario, ctx), ctx);
  const fired = firingActions(evaluated);
  const forbidden = new Set(
    fired
      .filter((a) => a["type"] === "forbid_exercise" && typeof a["exercise"] === "string")
      .map((a) => a["exercise"] as string),
  );

  const unfilteredExtract = extractFromWplJson(planJson);
  const filteredExtract = extractFromWplJson(stripForbidden(planJson, forbidden));

  const unfilteredScored = score(scenario, unfilteredExtract);
  const filteredScored = score(scenario, filteredExtract);

  if (unfilteredScored.violations.length === 0) {
    cleanByEmission++;
    continue;
  }

  if (filteredScored.violations.length === 0) {
    strippedByEvaluator++;
    strippedDetails.push({
      file: f.replace(".json", ""),
      stripped: [...new Set(unfilteredScored.violations.map((v) => v.item))],
    });
  } else {
    leakedThrough++;
    leaks.push({
      file: f.replace(".json", ""),
      viols: filteredScored.violations.map((v) => v.item),
    });
  }
}

const total = files.length;
console.log(`Lane B audit across ${total} runs:\n`);
console.log(`  Refused to generate           ${refusedToGenerate}  (fail-closed by refusal)`);
console.log(`  Failed to compile             ${compileFailed}  (fail-closed by validator)`);
console.log(`  Clean by emission             ${cleanByEmission}  (LLM never emitted a blacklisted exercise)`);
console.log(`  Stripped by rule evaluator    ${strippedByEvaluator}  (LLM emitted, evaluator removed)`);
console.log(`  Leaked through                ${leakedThrough}  (scorer would catch, evaluator missed)`);
console.log(`  ─────────────────────────────`);
console.log(`  Sum                           ${refusedToGenerate + compileFailed + cleanByEmission + strippedByEvaluator + leakedThrough} / ${total}`);

if (strippedDetails.length) {
  console.log(`\nCases where the rule evaluator stripped a blacklisted exercise:`);
  for (const d of strippedDetails.slice(0, 10)) {
    console.log(`  ${d.file}: stripped [${d.stripped.join(", ")}]`);
  }
  if (strippedDetails.length > 10) console.log(`  ...and ${strippedDetails.length - 10} more`);
}

if (leaks.length) {
  console.log(`\n⚠ LEAKED THROUGH (these should be zero — scorer caught what evaluator missed):`);
  for (const l of leaks) console.log(`  ${l.file}: [${l.viols.join(", ")}]`);
}
