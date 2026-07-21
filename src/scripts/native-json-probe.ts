// Native-JSON probe for v0.6 — Explanation B falsification.
//
// Hypothesis under test: WPL-AI's activity-block schema is too complex
// for LLMs to produce reliably from prose, *regardless of whether they
// go via the DSL→compile path or generate JSON directly*. The v0.6
// Lane B sweep observed that 27% of compiled plans on the strongest
// OpenAI model (gpt-5) and 83–87% on the Anthropic flagship (Opus 4.7)
// fail schema validation. If direct-JSON generation also fails at high
// rates when the schema is in-prompt, that is direct evidence for the
// format-too-complex hypothesis (vs. the prompt-incomplete one).
//
// Design:
//   - Single model: claude-sonnet-4-6 (middle tier; results bound the
//     range — Haiku probably worse, Opus probably similar).
//   - 5 representative scenarios drawn from the v0.6 sweep's failure
//     modes (orthopaedic, cardiac, postpartum, cycle-conditional).
//   - Single-turn prompt: the same single_turn_prompt the Lane B
//     pipeline uses. Same client context, different output format.
//   - System prompt: includes the full WPL JSON Schema verbatim, plus
//     the canonical exercise + cardio vocabulary so the LLM has the
//     same name-level guidance as the DSL Lane B prompt.
//   - Output: raw JSON only, no DSL, no compile step.
//   - Validation: @gymbile/wpl-validator (the same validator Lane B
//     uses on compiled plans).
//
// Apples-to-apples with v0.6 Lane B: same scenarios, same model,
// same vocabulary, same validator. The only thing that changes is
// the output format the model is asked to produce.
//
// Cost: ~5 calls × ~15k input × ~8k output on Sonnet ≈ $1–2.
// Output: experiments/native-json/<model>__<scenario>.json (one per
// trial) plus a single SUMMARY.json with aggregate.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { validate } from "@gymbile/wpl-validator";
import "../lib/env.js";
import { makeAnthropicModel } from "../models/anthropic.js";
import type { Scenario } from "../lib/types.js";

const PROBE_MODEL = "claude-sonnet-4-6";

const PROBE_SCENARIOS = [
  "torn_meniscus",
  "lumbar_disc",
  "severe_dysmenorrhea",
  "cardiac_post_mi",
  "post_csection_4wk",
];

// Extract the WPL JSON Schema from the bundled validator. The schema is
// embedded as a JS object literal in the validator's dist file; we walk
// brace depth to find its bounds, then eval it back into an object.
function loadWplSchema(): unknown {
  const src = readFileSync(
    resolve("node_modules/@gymbile/wpl-validator/dist/index.cjs"),
    "utf8",
  );
  const marker = '$schema: "https://json-schema.org';
  const markerIdx = src.indexOf(marker);
  if (markerIdx < 0) throw new Error("schema marker not found in validator");
  const open = src.lastIndexOf("{", markerIdx);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("schema literal end not found");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return eval(`(${src.slice(open, end + 1)})`);
}

function loadScenarios(): Record<string, Scenario> {
  const doc = parseYaml(
    readFileSync(resolve("scenarios/scenarios.yaml"), "utf8"),
  ) as { scenarios: Scenario[] };
  const out: Record<string, Scenario> = {};
  for (const s of doc.scenarios) out[s.id] = s;
  return out;
}

function buildSystemPrompt(schema: unknown): string {
  const schemaJson = JSON.stringify(schema, null, 2);
  return `You are a fitness AI that generates Wellness Plan Language (WPL) plans as strict JSON.

You will receive a client description and prescriber prompt. Your job is to emit a single JSON object that VALIDATES against the WPL JSON Schema below. Your output is consumed by a schema validator — it must be valid WPL JSON and nothing else.

OUTPUT RULES:
- Output a single raw JSON object. No prose, no commentary, no explanation.
- Do NOT wrap the JSON in markdown code fences.
- The top-level object MUST include "$schema", "version", and "plan" fields per the schema below.
- Every field name and value MUST conform to the schema. additionalProperties:false at most levels means unknown fields will be REJECTED.
- Activity blocks use a discriminated union via the "type" field. Match the type constant to the prescription shape exactly.
- IDs (activity ids, exercise refs, etc.) must match the slug pattern "^[a-z0-9][a-z0-9_-]*$" and must be unique within each scope the schema names.
- If the trainer asks for something contraindicated for the client, substitute or omit it. Do not include unsafe prescriptions.

WPL JSON SCHEMA (authoritative — your output is checked against this):

${schemaJson}
`;
}

interface ProbeResult {
  model: string;
  scenario_id: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_usd: number;
  refusal: boolean;
  parse_ok: boolean;
  parse_error: string | null;
  schema_valid: boolean | null;
  validator_errors: number | null;
  error_categories: Record<string, number>;
  top_error_paths: Array<{ path: string; count: number }>;
  raw_text: string;
  wpl_json: unknown;
}

function stripCodeFences(text: string): string {
  // Strip ```json … ``` or ``` … ``` if the model used them despite being asked not to.
  const fence = /^\s*```(?:json|JSON)?\s*([\s\S]*?)\s*```\s*$/;
  const m = text.match(fence);
  return m && m[1] !== undefined ? m[1] : text;
}

function aggregateErrors(errors: Array<{ path?: string; code?: string; message?: string }>): {
  categories: Record<string, number>;
  paths: Array<{ path: string; count: number }>;
} {
  const cats: Record<string, number> = {};
  const paths: Record<string, number> = {};
  for (const e of errors) {
    const msg = (e.message ?? "").replace(/'[^']+'/g, "'X'").replace(/[0-9]+/g, "N").slice(0, 80);
    cats[msg] = (cats[msg] ?? 0) + 1;
    const p = (e.path ?? "")
      .replace(/[0-9]+/g, "N")
      .replace(/^\/plan\//, "");
    paths[p] = (paths[p] ?? 0) + 1;
  }
  const topPaths = Object.entries(paths)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));
  return { categories: cats, paths: topPaths };
}

// Sonnet 4.6 pricing per /docs/en/about-claude/pricing: $3 input / $15 output per MTok.
function costSonnet(tokens_in: number, tokens_out: number): number {
  return (tokens_in * 3.0 + tokens_out * 15.0) / 1_000_000;
}

async function runOne(
  model: ReturnType<typeof makeAnthropicModel>,
  scenario: Scenario,
  systemPrompt: string,
): Promise<ProbeResult> {
  const result = await model.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: scenario.single_turn_prompt },
    ],
    { max_output_tokens: 16384 },
  );

  const base: Pick<ProbeResult, "model" | "scenario_id" | "tokens_in" | "tokens_out" | "latency_ms" | "cost_usd" | "raw_text"> = {
    model: PROBE_MODEL,
    scenario_id: scenario.id,
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    latency_ms: result.latency_ms,
    cost_usd: costSonnet(result.tokens_in, result.tokens_out),
    raw_text: result.text,
  };

  if (result.refusal) {
    return {
      ...base,
      refusal: true,
      parse_ok: false,
      parse_error: null,
      schema_valid: null,
      validator_errors: null,
      error_categories: {},
      top_error_paths: [],
      wpl_json: null,
    };
  }

  let wplJson: unknown;
  try {
    wplJson = JSON.parse(stripCodeFences(result.text));
  } catch (e) {
    return {
      ...base,
      refusal: false,
      parse_ok: false,
      parse_error: (e as Error).message.slice(0, 200),
      schema_valid: null,
      validator_errors: null,
      error_categories: {},
      top_error_paths: [],
      wpl_json: null,
    };
  }

  const v = validate(wplJson);
  const errors = v.errors ?? [];
  const { categories, paths } = aggregateErrors(errors);

  return {
    ...base,
    refusal: false,
    parse_ok: true,
    parse_error: null,
    schema_valid: v.valid,
    validator_errors: errors.length,
    error_categories: categories,
    top_error_paths: paths,
    wpl_json: wplJson,
  };
}

async function main(): Promise<void> {
  const schema = loadWplSchema();
  const scenarios = loadScenarios();
  const systemPrompt = buildSystemPrompt(schema);
  console.log(`[native-json-probe] system prompt length: ${systemPrompt.length} chars`);

  const outDir = resolve("experiments/native-json");
  mkdirSync(outDir, { recursive: true });
  const model = makeAnthropicModel(PROBE_MODEL);

  const all: ProbeResult[] = [];
  for (let i = 0; i < PROBE_SCENARIOS.length; i++) {
    const sid = PROBE_SCENARIOS[i]!;
    const s = scenarios[sid];
    if (!s) throw new Error(`scenario ${sid} not found`);
    console.log(`[${i + 1}/${PROBE_SCENARIOS.length}] ${PROBE_MODEL} / ${sid}`);
    const r = await runOne(model, s, systemPrompt);
    console.log(
      `  parse_ok=${r.parse_ok}  schema_valid=${r.schema_valid}  validator_errors=${r.validator_errors}  cost=$${r.cost_usd.toFixed(3)}`,
    );
    all.push(r);
    writeFileSync(resolve(outDir, `${PROBE_MODEL}__${sid}.json`), JSON.stringify(r, null, 2));
  }

  const totalCost = all.reduce((s, r) => s + r.cost_usd, 0);
  const parseOk = all.filter((r) => r.parse_ok).length;
  const schemaValid = all.filter((r) => r.schema_valid === true).length;
  const totalErrors = all.reduce((s, r) => s + (r.validator_errors ?? 0), 0);

  // Aggregate error categories across trials so we can compare to the
  // DSL-route schema-fail pattern from the main v0.6 sweep.
  const allCats: Record<string, number> = {};
  const allPaths: Record<string, number> = {};
  for (const r of all) {
    for (const [k, v] of Object.entries(r.error_categories)) {
      allCats[k] = (allCats[k] ?? 0) + v;
    }
    for (const p of r.top_error_paths) {
      allPaths[p.path] = (allPaths[p.path] ?? 0) + p.count;
    }
  }
  const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topPaths = Object.entries(allPaths).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const summary = {
    probe: "native-json",
    model: PROBE_MODEL,
    timestamp: new Date().toISOString(),
    scenarios_tested: PROBE_SCENARIOS.length,
    parse_ok: parseOk,
    schema_valid: schemaValid,
    total_validator_errors: totalErrors,
    cost_usd: totalCost,
    top_error_categories: topCats,
    top_error_paths: topPaths,
  };
  writeFileSync(resolve(outDir, "SUMMARY.json"), JSON.stringify(summary, null, 2));

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`scenarios:        ${PROBE_SCENARIOS.length}`);
  console.log(`parse_ok:         ${parseOk}/${PROBE_SCENARIOS.length}`);
  console.log(`schema_valid:     ${schemaValid}/${PROBE_SCENARIOS.length}`);
  console.log(`total errors:     ${totalErrors}`);
  console.log(`total cost:       $${totalCost.toFixed(2)}`);
  console.log(`top categories:`);
  for (const [k, v] of topCats.slice(0, 5)) console.log(`  ${String(v).padStart(5)}  ${k}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
