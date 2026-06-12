// Compare Lane B mechanism breakdown across prompt variants:
//   full           — vocabulary + safety instruction (baseline)
//   vocab-only     — vocabulary, no safety instruction
//   no-vocab       — safety instruction, no vocabulary
//   adversarial    — neither
//
// For each variant, count: refused / compile-failed / clean-by-emission /
// stripped-by-rule-evaluator / leaked-through. The hypothesis going in:
//
// - `full` baseline: 51 compile-fail, 29 clean-by-emission, 0 stripped, 0 leaked.
// - `vocab-only`: same compile pattern, possibly more stripped (LLM unprompted
//   on safety may emit blacklisted canonical names).
// - `no-vocab`: many more compile failures (LLM invents names), maybe some
//   stripped or leaked.
// - `adversarial`: maximum compile failure, plus the failure modes of both.

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

function tally(files: string[]) {
  let refused = 0, compileFailed = 0, cleanEmission = 0, stripped = 0, leaked = 0;
  let totalFinalViolations = 0;
  let totalCost = 0;
  const leakDetails: Array<{ file: string; viols: string[] }> = [];
  const stripDetails: Array<{ file: string; items: string[] }> = [];

  for (const f of files) {
    const r = JSON.parse(readFileSync(resolve(process.cwd(), "results", f), "utf8")) as RunResult;
    if (r.error) continue;
    totalCost += r.cost_usd;
    totalFinalViolations += r.safety_violations;

    const scenario = scenarios[r.scenario_id];
    if (!scenario) continue;
    if (r.refusal) { refused++; continue; }

    const text = r.raw_texts_per_turn?.[r.raw_texts_per_turn.length - 1] ?? r.raw_text ?? "";
    const compiled = compileWplAi(text);
    if (!compiled.ok) { compileFailed++; continue; }

    const planJson = compiled.json.plan as Record<string, unknown>;
    const ctx = buildClientContext(scenario);
    const { evaluated } = evaluateRules(buildPersonalization(scenario, ctx), ctx);
    const fired = firingActions(evaluated);
    const forbidden = new Set(
      fired
        .filter((a) => a["type"] === "forbid_exercise" && typeof a["exercise"] === "string")
        .map((a) => a["exercise"] as string),
    );
    const unfilteredScored = score(scenario, extractFromWplJson(planJson));
    const filteredScored = score(scenario, extractFromWplJson(stripForbidden(planJson, forbidden)));

    if (unfilteredScored.violations.length === 0) {
      cleanEmission++;
    } else if (filteredScored.violations.length === 0) {
      stripped++;
      stripDetails.push({
        file: f.replace(".json", ""),
        items: [...new Set(unfilteredScored.violations.map((v) => v.item))],
      });
    } else {
      leaked++;
      leakDetails.push({ file: f.replace(".json", ""), viols: filteredScored.violations.map((v) => v.item) });
    }
  }
  return { refused, compileFailed, cleanEmission, stripped, leaked, totalFinalViolations, totalCost, leakDetails, stripDetails, total: files.length };
}

const dir = resolve(process.cwd(), "results");
const allFiles = readdirSync(dir).filter((f) => f.endsWith(".json"));

const variants = {
  "full (baseline)": allFiles.filter((f) => f.includes("__B__single") && !f.includes("+") && !f.includes("variant-")),
  "vocab-only": allFiles.filter((f) => f.includes("__B__single") && f.includes("variant-vocab-only")),
  "no-vocab": allFiles.filter((f) => f.includes("__B__single") && f.includes("variant-no-vocab")),
  "adversarial": allFiles.filter((f) => f.includes("__B__single") && f.includes("variant-adversarial")),
};

console.log("Variant comparison (Lane B, single-turn only):\n");
console.log("Variant           | n  | Refused | CompileFail | CleanEmission | Stripped | Leaked | FinalViol | Cost");
console.log("------------------|----|---------|-------------|---------------|----------|--------|-----------|------");
for (const [name, files] of Object.entries(variants)) {
  if (files.length === 0) { console.log(`${name.padEnd(17)} | (no runs yet)`); continue; }
  const t = tally(files);
  console.log(`${name.padEnd(17)} | ${String(t.total).padStart(2)} | ${String(t.refused).padStart(7)} | ${String(t.compileFailed).padStart(11)} | ${String(t.cleanEmission).padStart(13)} | ${String(t.stripped).padStart(8)} | ${String(t.leaked).padStart(6)} | ${String(t.totalFinalViolations).padStart(9)} | $${t.totalCost.toFixed(3)}`);
}

// Surface any actual strippings or leaks
for (const [name, files] of Object.entries(variants)) {
  if (files.length === 0) continue;
  const t = tally(files);
  if (t.stripDetails.length || t.leakDetails.length) {
    console.log(`\n=== ${name} ===`);
    for (const s of t.stripDetails) console.log(`  STRIP  ${s.file}: [${s.items.join(", ")}]`);
    for (const l of t.leakDetails) console.log(`  LEAK   ${l.file}: [${l.viols.join(", ")}]`);
  }
}
