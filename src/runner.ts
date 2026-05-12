import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import "./lib/env.js";
import { makeOpenAiModel } from "./models/openai.js";
import { runLaneASingle, runLaneAMulti } from "./lanes/lane-a.js";
import { runLaneBSingle, runLaneBMulti } from "./lanes/lane-b.js";
import type { LockedModel, ModelName, Phase, RunResult, Scenario } from "./lib/types.js";
import { isPriced } from "./lib/pricing.js";

// The locked v0.1 sweep — these four ship in the published results table.
// Ad-hoc smoke tests against other OpenAI models are supported via
// `--model=<name>` (e.g. gpt-4o-mini).
const LOCKED_MODELS: LockedModel[] = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1"];

function loadScenarios(): Scenario[] {
  const path = resolve(process.cwd(), "scenarios/scenarios.yaml");
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw) as { scenarios?: Scenario[] };
  return doc.scenarios ?? [];
}

function resultPath(
  model: ModelName,
  scenario: string,
  lane: "A" | "B",
  phase: Phase,
  tag: string | undefined,
): string {
  const dir = resolve(process.cwd(), "results");
  mkdirSync(dir, { recursive: true });
  const modelPart = tag ? `${model}+${tag}` : model;
  return resolve(dir, `${modelPart}__${scenario}__${lane}__${phase}.json`);
}

function parseArgs(): {
  phase: Phase | "all";
  only: { model?: string; scenario?: string; lane?: "A" | "B" };
  tag?: string;
} {
  const argv = process.argv.slice(2);
  let phase: Phase | "all" = "all";
  let onlyModel: string | undefined;
  let onlyScenario: string | undefined;
  let onlyLane: "A" | "B" | undefined;
  let tag: string | undefined;
  for (const a of argv) {
    if (a === "--phase=single") phase = "single";
    else if (a === "--phase=multi") phase = "multi";
    else if (a.startsWith("--model=")) onlyModel = a.slice("--model=".length);
    else if (a.startsWith("--scenario=")) onlyScenario = a.slice("--scenario=".length);
    else if (a === "--lane=A" || a === "--lane=B") onlyLane = a.slice("--lane=".length) as "A" | "B";
    else if (a.startsWith("--tag=")) tag = a.slice("--tag=".length);
  }
  const only: { model?: string; scenario?: string; lane?: "A" | "B" } = {};
  if (onlyModel !== undefined) only.model = onlyModel;
  if (onlyScenario !== undefined) only.scenario = onlyScenario;
  if (onlyLane !== undefined) only.lane = onlyLane;
  return { phase, only, ...(tag !== undefined ? { tag } : {}) };
}

async function main(): Promise<void> {
  const { phase, only, tag } = parseArgs();
  const scenarios = loadScenarios();
  // If a single model is requested, use it verbatim (allows ad-hoc smoke
  // tests against models outside the locked sweep). Otherwise run the
  // locked four.
  const models: ModelName[] = only.model ? [only.model as ModelName] : [...LOCKED_MODELS];
  for (const m of models) {
    if (!isPriced(m)) {
      console.warn(`  WARN: ${m} has no pricing entry — cost_usd will be 0 in results.`);
    }
  }
  const targets = only.scenario ? scenarios.filter((s) => s.id === only.scenario) : scenarios;

  const phases: Phase[] = phase === "all" ? ["single", "multi"] : [phase];
  const lanes: Array<"A" | "B"> = only.lane ? [only.lane] : ["A", "B"];

  let done = 0;
  let skipped = 0;
  const total = models.length * targets.length * lanes.length * phases.length;
  if (tag) console.log(`Tag: ${tag} (results written as <model>+${tag}__...)`);
  console.log(`Running ${total} (model × scenario × lane × phase) combinations.`);

  for (const modelName of models) {
    const model = makeOpenAiModel(modelName);

    for (const scenario of targets) {
      for (const lane of lanes) {
        for (const p of phases) {
          const outPath = resultPath(modelName, scenario.id, lane, p, tag);
          if (existsSync(outPath)) {
            skipped++;
            done++;
            continue;
          }

          const label = `${modelName} / ${scenario.id} / Lane ${lane} / ${p}`;
          console.log(`[${done + 1}/${total}] ${label}`);
          let result: RunResult;
          try {
            if (lane === "A" && p === "single") result = await runLaneASingle(model, scenario);
            else if (lane === "A" && p === "multi") result = await runLaneAMulti(model, scenario);
            else if (lane === "B" && p === "single") result = await runLaneBSingle(model, scenario);
            else result = await runLaneBMulti(model, scenario);
          } catch (err) {
            console.error(`  ERROR: ${(err as Error).message}`);
            result = {
              model: modelName,
              scenario_id: scenario.id,
              lane,
              phase: p,
              safety_violations: 0,
              clean_plan: false,
              first_violation_week: null,
              drift_turn: null,
              refusal: false,
              latency_p50_ms: 0,
              latency_p95_ms: 0,
              tokens_in: 0,
              tokens_out: 0,
              cost_usd: 0,
              wpl_valid: null,
              wpl_schema_valid: null,
              compile_errors: null,
              validator_errors: null,
              violations: [],
              error: (err as Error).message,
              timestamp: new Date().toISOString(),
            };
          }

          writeFileSync(outPath, JSON.stringify(result, null, 2));
          done++;
        }
      }
    }
  }

  console.log(`Done. ${done - skipped} runs executed, ${skipped} cached.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
