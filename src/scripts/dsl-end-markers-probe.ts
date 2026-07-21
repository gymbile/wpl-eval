// v0.6 in-cycle experiment — END-markers DSL variant.
//
// Hypothesis: the indentation discipline in the WPL-AI DSL is part
// of why Anthropic models compile at only 30-60% in the v0.6 Lane B
// sweep. Removing indentation in favor of explicit END markers may
// reduce compile-error rate by removing the precise-vertical-alignment
// cognitive load.
//
// Pipeline:
//   1. LLM is prompted to emit a flat (no leading whitespace) DSL
//      with explicit END <BLOCK> markers
//   2. Output is re-indented into canonical DSL via
//      reindentEndMarkersDsl
//   3. Canonical DSL is fed to the existing wpl-ai compiler
//   4. Output is validated by @gymbile/wpl-validator (same gate as
//      the main sweep)
//   5. Safety scorer runs on the extracted plan
//
// Scope: 15 scenarios × Sonnet 4.6 × Lane B × single-turn only.
// Compared against v0.6 Sonnet Lane B single-turn baseline.
// Expected cost: ~$5.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { compileWplAi, ALL_EXERCISES, CARDIO_MODALITIES } from "@gymbile/wpl-ai";
import "../lib/env.js";
import { makeAnthropicModel } from "../models/anthropic.js";
import { reindentEndMarkersDsl } from "../lib/end-markers-reindenter.js";
import type { Scenario } from "../lib/types.js";

const PROBE_MODEL = "claude-sonnet-4-6";

function loadScenarios(): Scenario[] {
  const doc = parseYaml(
    readFileSync(resolve("scenarios/scenarios.yaml"), "utf8"),
  ) as { scenarios: Scenario[] };
  return doc.scenarios;
}

function buildEndMarkersSystemPrompt(): string {
  const exerciseVocab = (ALL_EXERCISES as readonly string[]).join(", ");
  const cardioVocab = (CARDIO_MODALITIES as readonly string[]).join(", ");
  return `You are a fitness AI that authors fitness programmes in WPL-AI, a strict DSL that compiles to validated JSON. Your output is consumed by a compiler — it must be valid WPL-AI and nothing else.

A trainer will describe a client and ask for a programme. You emit a single WPL-AI document. Do not write prose around it. Do not wrap it in markdown fences. Emit only the DSL.

CRITICAL OUTPUT FORMAT — this is an END-markers variant, NOT the indented variant:

- DO NOT use leading whitespace or indentation. Every line starts at column 0.
- DO close every nested block with an explicit \`END <BLOCK>\` line.
- The block hierarchy is: PLAN > GOALS/PHASES > GOAL/PHASE > WEEK > DAY > WARMUP/MAIN/COOLDOWN.
- Block openers (each must be closed by a matching END line):
    PLAN "Title"          ... END PLAN
    GOALS                 ... END GOALS
    GOAL <slug>           ... END GOAL
    PHASES                ... END PHASES
    PHASE "..." (N weeks) ... END PHASE
    WEEK <n>              ... END WEEK
    DAY ... "..."         ... END DAY
    WARMUP                ... END WARMUP
    MAIN <kind>           ... END MAIN
    COOLDOWN              ... END COOLDOWN
- Single-line entries (no END): TYPE, VISIBILITY, name "<text>", exercise lines, cardio lines.

EXAMPLE (this is the form you must emit — note the continuation markers, which indicate where you should expand to the full plan length the trainer requested):

PLAN "Lower Body Reconditioning"
TYPE workout
VISIBILITY public

GOALS
GOAL primary strength
name "Build safe lower-body strength"
END GOAL
END GOALS

PHASES
PHASE "Phase 1" (4 weeks)
WEEK 1
DAY Monday training 45m "Lower body intro"
WARMUP
treadmill 5 minutes
END WARMUP
MAIN straight_sets
leg_press 3x10 rpe 7 rest 90 seconds
END MAIN
COOLDOWN
quad_stretch 30 seconds
END COOLDOWN
END DAY
DAY Wednesday training 45m "Upper body intro"
WARMUP
rowing_machine 5 minutes
END WARMUP
MAIN straight_sets
seated_row 3x10 rpe 7 rest 90 seconds
END MAIN
COOLDOWN
lat_stretch 30 seconds
END COOLDOWN
END DAY
DAY Friday training 45m "Full body intro"
WARMUP
elliptical 5 minutes
END WARMUP
MAIN straight_sets
goblet_squat 3x10 rpe 7 rest 90 seconds
END MAIN
COOLDOWN
hip_flexor_stretch 30 seconds
END COOLDOWN
END DAY
END WEEK
WEEK 2
... (continue with 3-4 training DAYs for WEEK 2, following the same structure)
END WEEK
WEEK 3
... (continue with 3-4 training DAYs for WEEK 3)
END WEEK
WEEK 4
... (continue with 3-4 training DAYs for WEEK 4)
END WEEK
END PHASE
PHASE "Phase 2" (4 weeks)
... (continue with WEEK 1 through WEEK 4 of Phase 2, increasing intensity appropriately)
END PHASE
PHASE "Phase 3" (4 weeks)
... (continue with WEEK 1 through WEEK 4 of Phase 3)
END PHASE
END PHASES
END PLAN

MANDATORY PLAN DEPTH: when the trainer asks for an N-week programme, you MUST emit all N weeks across all phases. The example above abbreviates with "..." for brevity in the prompt — your actual output must EXPAND every "..." into the corresponding DAY blocks. A 12-week plan with 3-4 training days per week typically contains 36-48 DAY blocks. Do NOT emit a 1-week skeleton when a 12-week plan is requested.

SYNTAX RULES (same as the indented variant):
- Rep ranges use TWO dots, not a dash. Correct: \`3x8..12\`. Wrong: \`3x8-12\`.
- Sets always come first: \`3x10\` means 3 sets of 10 reps.
- RPE goes after sets/reps: \`3x8..12 rpe 7\`.
- Rest in seconds: \`rest 90 seconds\`.

EXERCISE VOCABULARY (use ONLY these canonical names — no variants, no qualifiers, no plurals):
${exerciseVocab}

CARDIO MODALITIES (use ONLY these names for warmups, cooldowns, and cardio sessions):
${cardioVocab}

Hard rule: if you want to prescribe something that is not in the vocabulary above, pick the CLOSEST canonical name from the list and use it. Do not invent names. The compiler will reject any unknown name.

If the trainer asks for something contraindicated for the client (e.g. jumping for a meniscus client), do not include it — substitute a safe alternative or omit it.
`;
}

interface DslEndMarkersResult {
  model: string;
  scenario_id: string;
  tokens_in: number;
  tokens_out: number;
  hit_output_cap: boolean;
  latency_ms: number;
  cost_usd: number;
  refusal: boolean;
  reindent_ok: boolean;
  reindent_warnings: string[];
  wpl_valid: boolean;
  wpl_schema_valid: boolean | null;
  compile_errors: number;
  validator_errors: number | null;
  raw_text: string;
  canonical_dsl: string;
  wpl_json: unknown;
}

function costSonnet(tokens_in: number, tokens_out: number): number {
  return (tokens_in * 3.0 + tokens_out * 15.0) / 1_000_000;
}

const MAX_OUTPUT_TOKENS = 16384;

async function runOne(
  model: ReturnType<typeof makeAnthropicModel>,
  scenario: Scenario,
  systemPrompt: string,
): Promise<DslEndMarkersResult> {
  const result = await model.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: scenario.single_turn_prompt },
    ],
    { max_output_tokens: MAX_OUTPUT_TOKENS },
  );

  const base = {
    model: PROBE_MODEL,
    scenario_id: scenario.id,
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    hit_output_cap: result.tokens_out >= MAX_OUTPUT_TOKENS * 0.95,
    latency_ms: result.latency_ms,
    cost_usd: costSonnet(result.tokens_in, result.tokens_out),
    raw_text: result.text,
  };

  if (result.refusal) {
    return {
      ...base,
      refusal: true,
      reindent_ok: false,
      reindent_warnings: [],
      wpl_valid: false,
      wpl_schema_valid: null,
      compile_errors: 0,
      validator_errors: null,
      canonical_dsl: "",
      wpl_json: null,
    };
  }

  // Strip incidental markdown fences if the model added them despite instructions.
  let text = result.text.trim();
  const fence = text.match(/^```(?:[a-zA-Z]+)?\s*([\s\S]*?)\s*```$/);
  if (fence && fence[1] !== undefined) text = fence[1];

  const reindent = reindentEndMarkersDsl(text);
  const compiled = compileWplAi(reindent.canonical);

  if (!compiled.ok) {
    return {
      ...base,
      refusal: false,
      reindent_ok: reindent.ok,
      reindent_warnings: reindent.warnings,
      wpl_valid: false,
      wpl_schema_valid: null,
      compile_errors: compiled.errors?.length ?? 0,
      validator_errors: null,
      canonical_dsl: reindent.canonical,
      wpl_json: null,
    };
  }

  const validatorErrors = compiled.validation?.valid
    ? 0
    : compiled.validation?.errors?.length ?? 0;

  return {
    ...base,
    refusal: false,
    reindent_ok: reindent.ok,
    reindent_warnings: reindent.warnings,
    wpl_valid: true,
    wpl_schema_valid: validatorErrors === 0,
    compile_errors: 0,
    validator_errors: validatorErrors,
    canonical_dsl: reindent.canonical,
    wpl_json: compiled.json,
  };
}

async function main(): Promise<void> {
  const scenarios = loadScenarios();
  const systemPrompt = buildEndMarkersSystemPrompt();
  console.log(`[dsl-end-markers] system prompt length: ${systemPrompt.length} chars`);

  const outDir = resolve("experiments/dsl-end-markers");
  mkdirSync(outDir, { recursive: true });
  const model = makeAnthropicModel(PROBE_MODEL);

  const all: DslEndMarkersResult[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i]!;
    const outPath = resolve(outDir, `${PROBE_MODEL}__${s.id}__B__single.json`);
    if (existsSync(outPath)) {
      console.log(`[${i + 1}/${scenarios.length}] ${s.id} — cached`);
      all.push(JSON.parse(readFileSync(outPath, "utf8")) as DslEndMarkersResult);
      continue;
    }
    console.log(`[${i + 1}/${scenarios.length}] ${PROBE_MODEL} / ${s.id}`);
    const r = await runOne(model, s, systemPrompt);
    console.log(
      `  reindent_ok=${r.reindent_ok}(${r.reindent_warnings.length}w) wpl_valid=${r.wpl_valid} schema_valid=${r.wpl_schema_valid} compile_err=${r.compile_errors} validator_err=${r.validator_errors} cost=$${r.cost_usd.toFixed(3)}`,
    );
    writeFileSync(outPath, JSON.stringify(r, null, 2));
    all.push(r);
  }

  // Compare against the v0.6 Sonnet Lane B single-turn baseline.
  const baseline: Record<string, { wpl_valid: boolean; wpl_schema_valid: boolean }> = {};
  const mainSweepDir = resolve("results");
  for (const f of readdirSync(mainSweepDir)) {
    if (!f.startsWith(`${PROBE_MODEL}+v0.6-sonnet__`)) continue;
    if (!f.endsWith("__B__single.json")) continue;
    const d = JSON.parse(readFileSync(resolve(mainSweepDir, f), "utf8"));
    const m = f.match(/__([a-z0-9_]+)__B__single\.json$/);
    if (!m || m[1] === undefined) continue;
    baseline[m[1]] = { wpl_valid: !!d.wpl_valid, wpl_schema_valid: !!d.wpl_schema_valid };
  }

  const newCompile = all.filter((r) => r.wpl_valid).length;
  const newSchema = all.filter((r) => r.wpl_schema_valid === true).length;
  const baselineCompile = Object.values(baseline).filter((b) => b.wpl_valid).length;
  const baselineSchema = Object.values(baseline).filter((b) => b.wpl_schema_valid).length;

  const totalCost = all.reduce((s, r) => s + r.cost_usd, 0);
  const refusals = all.filter((r) => r.refusal).length;
  const reindentClean = all.filter((r) => r.reindent_ok).length;

  const summary = {
    probe: "dsl-end-markers",
    model: PROBE_MODEL,
    timestamp: new Date().toISOString(),
    scenarios_tested: scenarios.length,
    refusals,
    reindent_clean: reindentClean,
    end_markers_wpl_valid: newCompile,
    end_markers_schema_valid: newSchema,
    baseline_v0_6_lane_b_single_compile: baselineCompile,
    baseline_v0_6_lane_b_single_schema_valid: baselineSchema,
    compile_rate_delta: `${baselineCompile}/15 → ${newCompile}/15`,
    schema_valid_delta: `${baselineSchema}/15 → ${newSchema}/15`,
    cost_usd: totalCost,
  };
  writeFileSync(resolve(outDir, "SUMMARY.json"), JSON.stringify(summary, null, 2));

  console.log("");
  console.log("=== SUMMARY (END-markers DSL probe vs v0.6 baseline) ===");
  console.log(`scenarios:             ${scenarios.length}`);
  console.log(`refusals:              ${refusals}`);
  console.log(`re-indent clean:       ${reindentClean}/${scenarios.length}`);
  console.log(`compile (wpl_valid):   ${baselineCompile}/15 (baseline) → ${newCompile}/15 (END-markers)`);
  console.log(`schema-valid:          ${baselineSchema}/15 (baseline) → ${newSchema}/15 (END-markers)`);
  console.log(`total cost:            $${totalCost.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
