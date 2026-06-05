// Native-JSON probe (OpenAI variant) — same 12-week setup as the
// Sonnet probe, but routed to gpt-5-mini whose larger output token
// window can actually fit a full WPL JSON plan.
//
// Why this exists: native-json-probe.ts hit Sonnet's 16K output cap
// on all 5 trials, leaving the question "can ANY current LLM emit a
// complete 12-week WPL JSON plan, given the schema, in one shot?"
// unanswered. gpt-5-mini is the closest OpenAI analog to Sonnet 4.6
// (mid-flagship tier), and the GPT-5 family supports much larger
// output windows. If gpt-5-mini also can't complete a plan within
// its budget OR produces lots of schema errors, that's stronger
// evidence the format itself is hostile. If it succeeds where Sonnet
// truncated, the v0.6 takeaway sharpens to "output-budget is a
// vendor/model issue, not an inherent WPL one."

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { validate } from "@gymbile/wpl-validator";
import "../lib/env.js";
import { makeOpenAiModel } from "../models/openai.js";
import type { Scenario } from "../lib/types.js";

const PROBE_MODEL = "gpt-5-mini";
const PROBE_SCENARIOS = [
  "torn_meniscus",
  "lumbar_disc",
  "severe_dysmenorrhea",
  "cardiac_post_mi",
  "post_csection_4wk",
];

// Big enough to hold a 12-week WPL JSON plan (~40k visible tokens).
// The OpenAI adapter multiplies by a reasoning factor for the GPT-5
// family, so the effective max_completion_tokens may be higher — we
// pass 32768 here and let the adapter handle the rest.
const MAX_OUTPUT_TOKENS = 32768;

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

interface ProbeResult {
  model: string;
  scenario_id: string;
  tokens_in: number;
  tokens_out: number;
  hit_output_cap: boolean;
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

// gpt-5-mini pricing per src/lib/pricing.ts: $0.25 input / $2.00 output per MTok.
function costGpt5Mini(tokens_in: number, tokens_out: number): number {
  return (tokens_in * 0.25 + tokens_out * 2.0) / 1_000_000;
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

async function runOne(
  model: ReturnType<typeof makeOpenAiModel>,
  scenario: Scenario,
  systemPrompt: string,
): Promise<ProbeResult> {
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
    // We can't know the exact cap the adapter applied, but if tokens_out
    // is anywhere close to MAX_OUTPUT_TOKENS, treat it as cap-bound.
    hit_output_cap: result.tokens_out >= MAX_OUTPUT_TOKENS * 0.95,
    latency_ms: result.latency_ms,
    cost_usd: costGpt5Mini(result.tokens_in, result.tokens_out),
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
  const outDir = resolve("results-native-json-openai");
  mkdirSync(outDir, { recursive: true });
  const model = makeOpenAiModel(PROBE_MODEL);

  const all: ProbeResult[] = [];
  for (let i = 0; i < PROBE_SCENARIOS.length; i++) {
    const sid = PROBE_SCENARIOS[i]!;
    const s = scenarios[sid];
    if (!s) throw new Error(`scenario ${sid} not found`);
    console.log(`[${i + 1}/${PROBE_SCENARIOS.length}] ${PROBE_MODEL} / ${sid}`);
    const r = await runOne(model, s, systemPrompt);
    console.log(
      `  tokens_out=${r.tokens_out} cap=${r.hit_output_cap} parse_ok=${r.parse_ok} schema_valid=${r.schema_valid} errors=${r.validator_errors} cost=$${r.cost_usd.toFixed(3)}`,
    );
    all.push(r);
    writeFileSync(resolve(outDir, `${PROBE_MODEL}__${sid}.json`), JSON.stringify(r, null, 2));
  }

  const totalCost = all.reduce((s, r) => s + r.cost_usd, 0);
  const parseOk = all.filter((r) => r.parse_ok).length;
  const schemaValid = all.filter((r) => r.schema_valid === true).length;
  const hitCap = all.filter((r) => r.hit_output_cap).length;
  const totalErrors = all.reduce((s, r) => s + (r.validator_errors ?? 0), 0);

  const allCats: Record<string, number> = {};
  for (const r of all) for (const [k, v] of Object.entries(r.error_categories)) allCats[k] = (allCats[k] ?? 0) + v;
  const topCats = Object.entries(allCats).sort((a, b) => b[1] - a[1]).slice(0, 10);

  writeFileSync(
    resolve(outDir, "SUMMARY.json"),
    JSON.stringify(
      {
        probe: "native-json-openai-12week",
        model: PROBE_MODEL,
        timestamp: new Date().toISOString(),
        scenarios_tested: PROBE_SCENARIOS.length,
        hit_output_cap: hitCap,
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
  console.log("=== SUMMARY (OpenAI 12-week direct JSON) ===");
  console.log(`scenarios:        ${PROBE_SCENARIOS.length}`);
  console.log(`hit output cap:   ${hitCap}/${PROBE_SCENARIOS.length}`);
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
