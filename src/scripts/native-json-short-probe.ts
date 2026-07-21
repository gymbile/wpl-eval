// Native-JSON probe (short-plan variant) — isolates schema-validity
// from output-token budget.
//
// The 12-week probe (native-json-probe.ts) hit Sonnet's 16K-token
// output cap on all 5 trials. That's evidence the WPL JSON
// representation of a 12-week plan is too large to emit in one shot,
// but it doesn't tell us whether shorter plans round-trip cleanly. If
// short plans DO validate, the 12-week truncation is a token-budget
// issue. If short plans ALSO fail validation, the schema itself is
// the bottleneck regardless of plan length.
//
// Same scenarios, same model, same schema-in-prompt. Only the user-
// facing prompt changes: we ask for a 2-week introductory block
// instead of the 12-week programme the scenarios specify.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const SHORT_PLAN_OVERRIDE = `
IMPORTANT OVERRIDE: For this exercise, generate a SHORT 2-week introductory plan only. Do NOT produce the full 12-week programme. A 2-week starter block focused on safe reconditioning is sufficient. Keep total activity count under ~30 across both weeks.
`;

function loadWplSchema(): unknown {
  const src = readFileSync(
    resolve("node_modules/@gymbile/wpl-validator/dist/index.cjs"),
    "utf8",
  );
  const markerIdx = src.indexOf('$schema: "https://json-schema.org');
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

interface ShortProbeResult {
  model: string;
  scenario_id: string;
  tokens_in: number;
  tokens_out: number;
  hit_token_cap: boolean;
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
  const m = text.match(/^\s*```(?:json|JSON)?\s*([\s\S]*?)\s*```\s*$/);
  return m && m[1] !== undefined ? m[1] : text;
}

function costSonnet(tokens_in: number, tokens_out: number): number {
  return (tokens_in * 3.0 + tokens_out * 15.0) / 1_000_000;
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
    const p = (e.path ?? "").replace(/[0-9]+/g, "N").replace(/^\/plan\//, "");
    paths[p] = (paths[p] ?? 0) + 1;
  }
  return {
    categories: cats,
    paths: Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([path, count]) => ({ path, count })),
  };
}

const MAX_TOKENS = 16384;

async function runOne(
  model: ReturnType<typeof makeAnthropicModel>,
  scenario: Scenario,
  systemPrompt: string,
): Promise<ShortProbeResult> {
  const userPrompt = scenario.single_turn_prompt + "\n\n" + SHORT_PLAN_OVERRIDE;
  const result = await model.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { max_output_tokens: MAX_TOKENS },
  );

  const base = {
    model: PROBE_MODEL,
    scenario_id: scenario.id,
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    hit_token_cap: result.tokens_out >= MAX_TOKENS,
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
  const outDir = resolve("experiments/native-json-short");
  mkdirSync(outDir, { recursive: true });
  const model = makeAnthropicModel(PROBE_MODEL);

  const all: ShortProbeResult[] = [];
  for (let i = 0; i < PROBE_SCENARIOS.length; i++) {
    const sid = PROBE_SCENARIOS[i]!;
    const s = scenarios[sid];
    if (!s) throw new Error(`scenario ${sid} not found`);
    console.log(`[${i + 1}/${PROBE_SCENARIOS.length}] ${PROBE_MODEL} / ${sid}`);
    const r = await runOne(model, s, systemPrompt);
    console.log(
      `  tokens_out=${r.tokens_out} cap=${r.hit_token_cap} parse_ok=${r.parse_ok} schema_valid=${r.schema_valid} errors=${r.validator_errors} cost=$${r.cost_usd.toFixed(3)}`,
    );
    all.push(r);
    writeFileSync(resolve(outDir, `${PROBE_MODEL}__${sid}__short.json`), JSON.stringify(r, null, 2));
  }

  const totalCost = all.reduce((s, r) => s + r.cost_usd, 0);
  const parseOk = all.filter((r) => r.parse_ok).length;
  const schemaValid = all.filter((r) => r.schema_valid === true).length;
  const hitCap = all.filter((r) => r.hit_token_cap).length;
  const totalErrors = all.reduce((s, r) => s + (r.validator_errors ?? 0), 0);

  const allCats: Record<string, number> = {};
  for (const r of all) for (const [k, v] of Object.entries(r.error_categories)) allCats[k] = (allCats[k] ?? 0) + v;
  const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 10);

  writeFileSync(
    resolve(outDir, "SUMMARY.json"),
    JSON.stringify(
      {
        probe: "native-json-short",
        model: PROBE_MODEL,
        timestamp: new Date().toISOString(),
        scenarios_tested: PROBE_SCENARIOS.length,
        hit_token_cap: hitCap,
        parse_ok: parseOk,
        schema_valid: schemaValid,
        total_validator_errors: totalErrors,
        cost_usd: totalCost,
        top_error_categories: topCats,
      },
      null,
      2,
    ),
  );

  console.log("");
  console.log("=== SUMMARY (short-plan) ===");
  console.log(`scenarios:        ${PROBE_SCENARIOS.length}`);
  console.log(`hit token cap:    ${hitCap}/${PROBE_SCENARIOS.length}`);
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
