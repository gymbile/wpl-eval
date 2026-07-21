// Plan-then-translate experiment.
//
// Hypothesis: the 32 shallow-served Lane B trials (compile-ok but <10
// weeks) are a model-laziness problem, not a model-understanding problem.
// If we force the model to commit to a structural plan FIRST and then
// translate that plan into WPL-AI DSL in a second call, depth should
// improve. The DSL's no-bracket property survives because Stage 2 still
// emits DSL — only Stage 1 produces a small structured JSON outline.
//
// Pipeline per trial:
//   Stage 1 — `planRequest(trainerPrompt)` → small TOC JSON
//               { duration_weeks, phases:[{name,weeks,focus}],
//                 weekly_template:{days_per_week, day_types[]},
//                 non_negotiables:[] }
//   Stage 2 — `translateToWpl(trainerPrompt, toc)` → WPL-AI DSL
//
// Run on the 32 shallow trials with the same model+scenario combination
// as the original. Save results under experiments/plan-then-translate/ so we
// don't pollute the main corpus. Report: deep-recovery rate.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileWplAi, ALL_EXERCISES, CARDIO_MODALITIES } from "@gymbile/wpl-ai";
import "../lib/env.js";
import { makeOpenAiModel } from "../models/openai.js";
import type { Scenario, ModelName } from "../lib/types.js";
import type { ChatMessage } from "../models/types.js";

const outDir = resolve(process.cwd(), "experiments/plan-then-translate");
mkdirSync(outDir, { recursive: true });

const scenariosByName: Record<string, Scenario> = {};
{
  const doc = parseYaml(
    readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8"),
  ) as { scenarios: Scenario[] };
  for (const s of doc.scenarios) scenariosByName[s.id] = s;
}

// Identify the 32 shallow-served trials from the main corpus.
const resultsDir = resolve(process.cwd(), "results");
const shallow: Array<{
  file: string;
  model: string;
  scenarioId: string;
  phase: "single" | "multi";
  weeks: number;
}> = [];
for (const f of readdirSync(resultsDir)) {
  if (!f.endsWith(".json")) continue;
  if (!f.includes("__B__")) continue;
  if (f === "schema.json") continue;
  const d = JSON.parse(readFileSync(resolve(resultsDir, f), "utf8"));
  if (d.lane_b?.outcome !== "served") continue;
  const phases = (d.wpl_json?.plan?.phases ?? []) as Array<{ weeks?: unknown[] }>;
  const weeks = phases.reduce((s, p) => s + (p.weeks?.length ?? 0), 0);
  if (weeks < 10) {
    shallow.push({
      file: f,
      model: d.model,
      scenarioId: d.scenario_id,
      phase: d.phase,
      weeks,
    });
  }
}
console.log(`Shallow-served trials to re-run: ${shallow.length}`);

// ---------- Stage 1: planning ----------

const PLAN_SYSTEM = `You are a strength & conditioning coach extracting the structural plan for a fitness programme from a trainer's brief. You will produce a JSON object describing the SHAPE of the programme — not the contents. The downstream stage will fill in the day-by-day exercises.

Output STRICT JSON only. No markdown, no commentary. Schema:

{
  "duration_weeks": <integer>,
  "phases": [
    { "name": "<short phrase>", "weeks": <integer>, "focus": "<one-sentence focus>" }
  ],
  "weekly_template": {
    "days_per_week": <integer>,
    "day_types": [ "<short label>", ... ]
  },
  "non_negotiables": [ "<safety/equipment constraint phrased as a directive>", ... ]
}

Rules:
- Sum of phases[].weeks MUST equal duration_weeks
- day_types.length MUST equal days_per_week
- Phrases stay short. This is a table of contents, not the plan.
- Echo every safety constraint from the brief into non_negotiables verbatim or as a short directive.
- If the trainer said "12 weeks" — duration_weeks is 12. Do not silently shorten.`;

interface PlanToc {
  duration_weeks: number;
  phases: { name: string; weeks: number; focus: string }[];
  weekly_template: { days_per_week: number; day_types: string[] };
  non_negotiables: string[];
}

async function planRequest(
  modelName: string,
  trainerPrompt: string,
): Promise<{ toc: PlanToc | null; tokens_in: number; tokens_out: number; raw: string }> {
  const model = makeOpenAiModel(modelName as ModelName);
  const messages: ChatMessage[] = [
    { role: "system", content: PLAN_SYSTEM },
    { role: "user", content: trainerPrompt },
  ];
  const r = await model.chat(messages, { temperature: 0, max_output_tokens: 2000 });
  let toc: PlanToc | null = null;
  try {
    const text = r.text.trim().replace(/^```json\n?|\n?```$/g, "");
    toc = JSON.parse(text);
  } catch {
    toc = null;
  }
  return { toc, tokens_in: r.tokens_in, tokens_out: r.tokens_out, raw: r.text };
}

// ---------- Stage 2: DSL translation ----------

const EXERCISE_VOCAB = (ALL_EXERCISES as readonly string[]).join(", ");
const CARDIO_VOCAB = (CARDIO_MODALITIES as readonly string[]).join(", ");

const TRANSLATE_SYSTEM = `You are a fitness AI that authors fitness programmes in WPL-AI, a strict DSL that compiles to validated JSON. Your output is consumed by a compiler — it must be valid WPL-AI and nothing else.

You will receive (1) a trainer brief and (2) a STRUCTURAL PLAN TOC produced by an earlier planning step. Your job is to expand the TOC into the full WPL-AI DSL. You MUST emit every week declared in the TOC. If duration_weeks is 12, emit 12 WEEK blocks. The TOC is a contract, not a suggestion.

Output ONLY WPL-AI DSL. No prose. No markdown fences. No commentary.

Exercise vocabulary (canonical names — pick the closest match, do not invent):
${EXERCISE_VOCAB}

Cardio modalities:
${CARDIO_VOCAB}

DSL shape:
  PLAN "..."
  TYPE workout
  VISIBILITY public
  GOALS
    GOAL primary <category>:
      name "..."
  PHASES
    PHASE "<name>" (<N> weeks):
      WEEK 1:
        DAY <day_name> training <duration>m "<label>":
          warmup:
            <activity> <duration>m
          main straight_sets:
            <exercise_ref> <sets>x<reps> rpe <n> rest <s> seconds
          cooldown:
            <activity> <duration>m
      WEEK 2:
        ...
      ...
      WEEK <N>:
        ...

For every WEEK in every PHASE: emit at least one DAY block with at least one main-block activity.`;

async function translateToWpl(
  modelName: string,
  trainerPrompt: string,
  toc: PlanToc,
): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const model = makeOpenAiModel(modelName as ModelName);
  const userPrompt = `Trainer brief:
${trainerPrompt}

Structural plan TOC (you MUST match this shape):
${JSON.stringify(toc, null, 2)}

Emit the full WPL-AI DSL now.`;
  const messages: ChatMessage[] = [
    { role: "system", content: TRANSLATE_SYSTEM },
    { role: "user", content: userPrompt },
  ];
  const r = await model.chat(messages, { temperature: 0, max_output_tokens: 16000 });
  return { text: r.text, tokens_in: r.tokens_in, tokens_out: r.tokens_out };
}

// ---------- runner ----------

async function runOne(t: (typeof shallow)[number]) {
  const scenario = scenariosByName[t.scenarioId]!;
  const trainerPrompt =
    t.phase === "single" ? scenario.single_turn_prompt : scenario.multi_turn[0]!;

  console.log(`[plan-then-translate] ${t.model} / ${t.scenarioId} / ${t.phase}`);

  const stage1 = await planRequest(t.model, trainerPrompt);
  if (!stage1.toc) {
    console.log(`  Stage 1 failed to produce JSON`);
    return { ok: false, t, reason: "stage1_json_fail" };
  }
  const stage2 = await translateToWpl(t.model, trainerPrompt, stage1.toc);
  const compiled = compileWplAi(stage2.text);

  let weeks = 0;
  let compileOk = compiled.ok;
  if (compiled.ok) {
    const plan = (compiled.json as { plan?: { phases?: Array<{ weeks?: unknown[] }> } }).plan;
    weeks = (plan?.phases ?? []).reduce((s, p) => s + (p.weeks?.length ?? 0), 0);
  }
  console.log(
    `  Stage 1 declared: ${stage1.toc.duration_weeks}w / ${stage1.toc.phases.length} phases   `
      + `Stage 2 compiled: ok=${compileOk} weeks=${weeks}`,
  );

  const out = {
    trial: t,
    stage1: { toc: stage1.toc, tokens_in: stage1.tokens_in, tokens_out: stage1.tokens_out, raw: stage1.raw },
    stage2: {
      text: stage2.text,
      tokens_in: stage2.tokens_in,
      tokens_out: stage2.tokens_out,
      compile_ok: compileOk,
      compile_errors: compiled.ok ? 0 : compiled.errors.length,
      weeks_compiled: weeks,
      first_error: compiled.ok ? null : (compiled.errors[0] as Record<string, unknown> | undefined),
    },
  };
  writeFileSync(resolve(outDir, t.file), JSON.stringify(out, null, 2));
  return { ok: true, weeks_compiled: weeks, t };
}

async function main() {
  const results: Array<{ t: (typeof shallow)[number]; weeks_compiled: number; ok: boolean }> = [];
  for (const t of shallow) {
    try {
      const r = await runOne(t);
      if (r.ok) results.push({ t: r.t, weeks_compiled: r.weeks_compiled!, ok: true });
      else results.push({ t: r.t, weeks_compiled: 0, ok: false });
    } catch (e) {
      console.error(`  ERROR:`, (e as Error).message);
      results.push({ t, weeks_compiled: 0, ok: false });
    }
  }

  console.log();
  console.log("=== Summary ===");
  const recovered = results.filter((r) => r.weeks_compiled >= 10).length;
  const stillShallow = results.filter((r) => r.ok && r.weeks_compiled > 0 && r.weeks_compiled < 10).length;
  const compileFail = results.filter((r) => !r.ok || r.weeks_compiled === 0).length;
  console.log(`Before: 32 shallow-served (<10w)`);
  console.log(`After plan-then-translate:`);
  console.log(`  deep (≥10w):     ${recovered}/${shallow.length}`);
  console.log(`  still shallow:   ${stillShallow}/${shallow.length}`);
  console.log(`  compile failed:  ${compileFail}/${shallow.length}`);
  console.log();
  console.log("Per-trial:");
  for (const r of results) {
    const marker = r.weeks_compiled >= 10 ? "✓" : r.ok && r.weeks_compiled > 0 ? "~" : "✗";
    console.log(`  ${marker} ${r.t.file.padEnd(60)} weeks=${r.weeks_compiled}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
