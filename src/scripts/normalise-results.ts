// Normalise every results/*.json into the v1 schema documented at
// results/schema.json. Idempotent — running twice yields no changes.
//
// What this script adds beyond the raw runner output:
//   1. `schemaVersion` and `evalVersion` self-identifying fields
//   2. Re-scored `violations[]` (rescore.ts behaviour) and per-turn
//      `violations_per_turn` derived from `extracted_plans_per_turn`
//   3. Enriched violations: each entry now carries `rawName` (verbatim string
//      from the extracted plan that triggered the match) and `turn` (which
//      conversational turn introduced it).
//   4. `lane_b` envelope with outcome classification. For Lane B trials that
//      compile-failed, re-runs `compileWplAi(raw_text)` offline to recover the
//      structured error list — the original runner only persisted a count.
//   5. `drift_turn` recomputed from per-turn plans.
//
// No LLM calls. Pure local recomputation against the stored artefacts.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileWplAi } from "@gymbile/wpl-ai";
import { score, collides } from "../scoring/blacklist.js";
import { firstDriftTurn } from "../scoring/drift.js";
import type { ExtractedPlan, Scenario, Violation } from "../lib/types.js";

// Walk a compiled WPL JSON document and pull out (exercise, week) pairs.
// Identical contract to lane-b.ts's extractFromWplJson, replicated locally
// so the normaliser doesn't depend on lane internals. Used to repopulate
// extracted_plan for older Lane B trials whose runner did not persist it.
function extractFromWplJson(wplJson: Record<string, unknown> | null | undefined): ExtractedPlan | null {
  if (!wplJson) return null;
  const plan = (wplJson as { plan?: Record<string, unknown> }).plan;
  if (!plan) return null;
  const phases = ((plan as { phases?: unknown[] }).phases ?? []) as Array<{
    weeks?: Array<{ order?: number; days?: unknown[] }>;
  }>;
  const exercises: { name: string; week: number | null }[] = [];
  let weekCounter = 0;
  for (const phase of phases) {
    for (const week of phase.weeks ?? []) {
      weekCounter++;
      const wk = week.order ?? weekCounter;
      for (const day of (week.days ?? []) as Array<{ blocks?: unknown[]; activities?: unknown[] }>) {
        const blocks = (day.blocks ?? day.activities ?? []) as Array<{ activities?: unknown[] }>;
        for (const block of blocks) {
          for (const act of (block.activities ?? []) as Array<{
            type?: string;
            exercise_ref?: string;
            name?: string;
          }>) {
            if (act.type === "exercise" && (act.exercise_ref || act.name)) {
              exercises.push({ name: act.exercise_ref ?? act.name ?? "", week: wk });
            }
          }
        }
      }
    }
  }
  // Dedupe by name+week so repeated days within a phase don't multiply.
  const seen = new Set<string>();
  const out: { name: string; week: number | null }[] = [];
  for (const e of exercises) {
    const k = `${e.name}@${e.week}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return { exercises: out, foods: [], intensities: [], notes: [] };
}

const SCHEMA_VERSION = "1";

// Single source of truth for the eval version stamp. Bump when releasing a
// new tag; CI ensures every result file carries the matching value.
const pkgJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};
const EVAL_VERSION = `v${pkgJson.version}`;

const resultsDir = resolve(process.cwd(), "results");
const scenariosPath = resolve(process.cwd(), "scenarios/scenarios.yaml");

const scenariosByName: Record<string, Scenario> = {};
{
  const raw = readFileSync(scenariosPath, "utf8");
  const doc = parseYaml(raw) as { scenarios: Scenario[] };
  for (const s of doc.scenarios) scenariosByName[s.id] = s;
}

interface RichViolation extends Violation {
  rawName?: string;
  turn?: number | null;
}

// For a given violation, find the verbatim extracted-plan entry that
// triggered the match. Returns the most specific name available so the
// site renderer can highlight it directly.
function findRawName(plan: ExtractedPlan | null | undefined, v: Violation): string | undefined {
  if (!plan) return undefined;
  if (v.kind === "exercise") {
    const hit = plan.exercises.find((e) => collides(e.name, v.item));
    return hit?.name;
  }
  if (v.kind === "food") {
    const hit = plan.foods.find((f) => collides(f.name, v.item));
    return hit?.name;
  }
  if (v.kind === "intensity") {
    const hit = plan.intensities.find((i) => v.item.includes(i.domain));
    return hit ? `${hit.domain}=${hit.level}` : undefined;
  }
  if (v.kind === "session_start") {
    const hit = plan.notes.find((n) => collides(n, v.item));
    return hit;
  }
  return undefined;
}

function enrichViolations(
  violations: Violation[],
  plan: ExtractedPlan | null | undefined,
  turn: number | null,
): RichViolation[] {
  return violations.map((v) => {
    const rich: RichViolation = { ...v };
    const rawName = findRawName(plan, v);
    if (rawName !== undefined) rich.rawName = rawName;
    if (turn !== null) rich.turn = turn;
    return rich;
  });
}

// Lane B outcome classifier. Strip-count instrumentation isn't in v0.1
// runner output, so `stripped_clean` / `stripped_with_residual` only appear
// once that data is captured. Until then, served = compiled + 0 violations,
// compile_failed = !compiled, residual = compiled with violations (defensive
// — should be 0 across the v0.1 corpus).
type LaneBOutcome =
  | "served"
  | "compile_failed"
  | "stripped_clean"
  | "stripped_with_residual";

function classifyLaneB(r: RawResult): LaneBOutcome {
  if (!r.wpl_valid) return "compile_failed";
  if ((r.safety_violations ?? 0) > 0) return "stripped_with_residual";
  // Without strip-count instrumentation we cannot distinguish a plan that
  // was clean on first emission from one that was cleaned by the rule
  // evaluator. Both report as `served` for now — when the runner persists
  // strip_counts, normaliser can promote to `stripped_clean` where count > 0.
  return "served";
}

interface RawResult {
  model: string;
  scenario_id: string;
  lane: "A" | "B";
  phase: "single" | "multi";
  safety_violations: number;
  clean_plan: boolean;
  first_violation_week: number | null;
  drift_turn: number | null;
  refusal: boolean;
  wpl_valid?: boolean | null;
  wpl_schema_valid?: boolean | null;
  compile_errors?: number | null;
  validator_errors?: number | null;
  violations: Violation[];
  extracted_plan?: ExtractedPlan | null;
  extracted_plans_per_turn?: (ExtractedPlan | null)[] | null;
  raw_text?: string | null;
  raw_texts_per_turn?: string[] | null;
  wpl_json?: Record<string, unknown> | null;
  timestamp: string;
  [k: string]: unknown;
}

const files = readdirSync(resultsDir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => f !== "schema.json");

let touched = 0;
const compileRecoveries: string[] = [];

for (const f of files) {
  const path = resolve(resultsDir, f);
  const r = JSON.parse(readFileSync(path, "utf8")) as RawResult;
  const scenario = scenariosByName[r.scenario_id];
  if (!scenario) {
    console.warn(`  skip ${f}: unknown scenario ${r.scenario_id}`);
    continue;
  }

  // Lane B re-derivation: older runners did not persist extracted_plan for
  // Lane B trials, leaving the field empty even when wpl_json was fully
  // compiled. Walk the compiled document offline to restore the data so
  // every downstream consumer (scoring, drift, site) sees a consistent
  // shape. No LLM cost — this is a pure function of wpl_json.
  if (r.lane === "B") {
    const ep = r.extracted_plan;
    const isEmpty =
      !ep ||
      ((ep.exercises?.length ?? 0) === 0 &&
        (ep.foods?.length ?? 0) === 0 &&
        (ep.intensities?.length ?? 0) === 0);
    if (isEmpty && r.wpl_json) {
      const rederived = extractFromWplJson(r.wpl_json);
      if (rederived) r.extracted_plan = rederived;
    }
  }

  const turnPlans: (ExtractedPlan | null)[] = r.extracted_plans_per_turn ?? [];

  // Per-turn violations: prefer the per-turn plan, fall back to the single
  // aggregated plan for single-turn trials.
  const perTurnViolations: RichViolation[][] = [];
  if (turnPlans.length > 0) {
    for (let i = 0; i < turnPlans.length; i++) {
      const plan = turnPlans[i];
      if (!plan) {
        perTurnViolations.push([]);
        continue;
      }
      const scored = score(scenario, plan);
      perTurnViolations.push(enrichViolations(scored.violations, plan, i + 1));
    }
  } else if (r.extracted_plan) {
    const scored = score(scenario, r.extracted_plan);
    perTurnViolations.push(enrichViolations(scored.violations, r.extracted_plan, null));
  } else {
    perTurnViolations.push([]);
  }

  // Aggregate violations — deduplicate by kind:item, preserving earliest turn
  // so consumers can see the first surfaced match.
  const seen = new Map<string, RichViolation>();
  for (const turnViols of perTurnViolations) {
    for (const v of turnViols) {
      const key = `${v.kind}:${v.item}`;
      const existing = seen.get(key);
      if (!existing) seen.set(key, v);
    }
  }
  const aggregated = Array.from(seen.values());

  // Final-turn or single-plan scoring drives the headline `safety_violations`
  // count to stay consistent with prior reporting.
  const finalPlan =
    turnPlans.length > 0 ? turnPlans[turnPlans.length - 1] : r.extracted_plan ?? null;
  const finalScored = finalPlan ? score(scenario, finalPlan) : { violations: [], first_violation_week: null, clean_plan: true };

  // Drift recompute (multi-turn only).
  let driftTurn: number | null = null;
  if (r.phase === "multi" && turnPlans.length > 0) {
    const perTurnRaw = turnPlans.map((p) => (p ? score(scenario, p).violations : []));
    driftTurn = firstDriftTurn(perTurnRaw, scenario);
  }

  // Lane B envelope. For compile_failed trials with stored raw_text, recover
  // the structured error list so the site can render real RepairHintCards.
  type LaneBEnvelope = {
    outcome: LaneBOutcome;
    compile_error: { code: string; message: string; repair_hint: Record<string, unknown> | null } | null;
    all_errors: unknown[] | null;
    strip_counts: { rule: string; count: number }[];
    served_wpl: Record<string, unknown> | null;
  };
  let laneB: LaneBEnvelope | null = null;
  if (r.lane === "B") {
    const outcome = classifyLaneB({ ...r, safety_violations: finalScored.violations.length });
    laneB = {
      outcome,
      compile_error: null,
      all_errors: null,
      strip_counts: [],
      served_wpl: outcome === "served" ? r.wpl_json ?? null : null,
    };
    if (outcome === "compile_failed" && typeof r.raw_text === "string" && r.raw_text.length > 0) {
      try {
        const recompiled = compileWplAi(r.raw_text);
        if (!recompiled.ok) {
          const firstErr = recompiled.errors[0] as Record<string, unknown> | undefined;
          const repairHint =
            firstErr && typeof firstErr.repair_hint === "object"
              ? (firstErr.repair_hint as Record<string, unknown>)
              : firstErr?.details && typeof firstErr.details === "object"
                ? ((firstErr.details as Record<string, unknown>).repair_hint as Record<string, unknown> | undefined) ?? null
                : null;
          laneB.compile_error = {
            code: (firstErr?.type as string) ?? "UNKNOWN",
            message: (firstErr?.message as string) ?? "",
            repair_hint: repairHint,
          };
          laneB.all_errors = recompiled.errors as unknown[];
          compileRecoveries.push(f);
        }
      } catch {
        // Tolerate any rehydration failure — leave compile_error null.
      }
    }
  }

  // Build the normalised record. Field order chosen so the most-read
  // headline metrics sit near the top.
  const out = {
    schemaVersion: SCHEMA_VERSION,
    evalVersion: EVAL_VERSION,
    model: r.model,
    scenario_id: r.scenario_id,
    lane: r.lane,
    phase: r.phase,
    safety_violations: finalScored.violations.length,
    clean_plan:
      r.lane === "A"
        ? finalScored.violations.length === 0 && !r.refusal
        : !!r.wpl_valid && finalScored.violations.length === 0 && !r.refusal,
    first_violation_week: finalScored.first_violation_week,
    drift_turn: r.phase === "multi" ? driftTurn : null,
    refusal: !!r.refusal,
    latency_p50_ms: r.latency_p50_ms ?? 0,
    latency_p95_ms: r.latency_p95_ms ?? 0,
    tokens_in: r.tokens_in ?? 0,
    tokens_out: r.tokens_out ?? 0,
    cost_usd: r.cost_usd ?? 0,
    wpl_valid: r.wpl_valid ?? null,
    wpl_schema_valid: r.wpl_schema_valid ?? null,
    compile_errors: r.compile_errors ?? null,
    validator_errors: r.validator_errors ?? null,
    violations: aggregated,
    violations_per_turn: perTurnViolations,
    extracted_plan: r.extracted_plan ?? null,
    extracted_plans_per_turn: r.extracted_plans_per_turn ?? null,
    raw_text: r.raw_text ?? null,
    raw_texts_per_turn: r.raw_texts_per_turn ?? null,
    lane_b: laneB,
    extraction_parse_ok: typeof r.extraction_parse_ok === "boolean" ? r.extraction_parse_ok : undefined,
    wpl_json: r.wpl_json ?? null,
    error: (r.error as string | undefined) ?? null,
    timestamp: r.timestamp,
  };

  // Carry through any unrecognised top-level fields (e.g. `variant`) so
  // normalisation stays additive.
  for (const k of Object.keys(r)) {
    if (!(k in out) && k !== "lane_b") {
      (out as Record<string, unknown>)[k] = r[k];
    }
  }

  writeFileSync(path, JSON.stringify(out, null, 2));
  touched++;
}

console.log(`Normalised ${touched}/${files.length} files at evalVersion=${EVAL_VERSION}.`);
if (compileRecoveries.length) {
  console.log(`Recovered structured compile errors for ${compileRecoveries.length} Lane B compile_failed trials.`);
}
