import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import "./lib/env.js";
import { makeOpenAiModel } from "./models/openai.js";
import { makeAnthropicModel } from "./models/anthropic.js";
import { makeGeminiModel } from "./models/gemini.js";
import { runLaneASingle, runLaneAMulti } from "./lanes/lane-a.js";
import { runLaneBSingle, runLaneBMulti } from "./lanes/lane-b.js";
import type {
  LockedModelV05,
  LockedModelV06,
  LockedModelV07,
  ModelName,
  Phase,
  RunResult,
  Scenario,
} from "./lib/types.js";
import { isPriced } from "./lib/pricing.js";
import { ALL_EXERCISES } from "@gymbile/wpl-ai";
import { isLifecycle, validateLifecycleScenario } from "./lib/lifecycle.js";

// v0.5 locked sweep — these four ship in the published v0.5 results. Frozen
// so historical results stay reproducible against the same lineup.
const LOCKED_MODELS_V0_5: LockedModelV05[] = ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1"];

// v0.6 widens the lineup to add three Anthropic Claude models. Mirrors the
// flagship / mid / cheap tier shape of the OpenAI side so the cross-vendor
// leaderboard is interpretable. Pass `--sweep=v0.6` to use this set;
// default remains v0.5 for backwards compatibility with existing reruns.
const LOCKED_MODELS_V0_6: LockedModelV06[] = [
  ...LOCKED_MODELS_V0_5,
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

// v0.7 adds three Google Gemini models — the third vendor lane. Pass
// `--sweep=v0.7` to use this set.
const LOCKED_MODELS_V0_7: LockedModelV07[] = [
  ...LOCKED_MODELS_V0_6,
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

function isAnthropic(name: ModelName): boolean {
  return name.startsWith("claude-");
}

function isGemini(name: ModelName): boolean {
  return name.startsWith("gemini-");
}

function makeModel(name: ModelName) {
  if (isAnthropic(name)) return makeAnthropicModel(name);
  if (isGemini(name)) return makeGeminiModel(name);
  return makeOpenAiModel(name);
}

function loadScenarios(): Scenario[] {
  const path = resolve(process.cwd(), "scenarios/scenarios.yaml");
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw) as { scenarios?: Scenario[] };
  const scenarios = doc.scenarios ?? [];
  // v0.7: fail loud on invalid lifecycle authoring before any LLM call.
  const vocab = new Set(ALL_EXERCISES as readonly string[]);
  for (const s of scenarios) validateLifecycleScenario(s, vocab);
  return scenarios;
}

function resultPath(
  model: ModelName,
  scenario: string,
  lane: "A" | "B",
  phase: Phase,
  tag: string | undefined,
  repeatIndex?: number,
  baseDir = "results",
): string {
  const dir = resolve(process.cwd(), baseDir);
  mkdirSync(dir, { recursive: true });
  const modelPart = tag ? `${model}+${tag}` : model;
  // k=1 keeps the legacy un-suffixed name so existing tooling still finds it.
  // k>1 appends __r<k> so repeat trials are stored separately.
  const repeatSuffix = repeatIndex !== undefined && repeatIndex > 1 ? `__r${repeatIndex}` : "";
  return resolve(dir, `${modelPart}__${scenario}__${lane}__${phase}${repeatSuffix}.json`);
}

function parseArgs(): {
  phase: Phase | "all";
  sweep: "v0.5" | "v0.6" | "v0.7";
  only: { model?: string; scenario?: string; lane?: "A" | "B" };
  tag?: string;
  repeats: number;
  outDir: string;
} {
  const argv = process.argv.slice(2);
  let phase: Phase | "all" = "all";
  let sweep: "v0.5" | "v0.6" | "v0.7" = "v0.5";
  let onlyModel: string | undefined;
  let onlyScenario: string | undefined;
  let onlyLane: "A" | "B" | undefined;
  let tag: string | undefined;
  let repeats = 1;
  let outDir = "results";
  for (const a of argv) {
    if (a === "--phase=single") phase = "single";
    else if (a === "--phase=multi") phase = "multi";
    else if (a === "--sweep=v0.5") sweep = "v0.5";
    else if (a === "--sweep=v0.6") sweep = "v0.6";
    else if (a === "--sweep=v0.7") sweep = "v0.7";
    else if (a.startsWith("--model=")) onlyModel = a.slice("--model=".length);
    else if (a.startsWith("--scenario=")) onlyScenario = a.slice("--scenario=".length);
    else if (a === "--lane=A" || a === "--lane=B") onlyLane = a.slice("--lane=".length) as "A" | "B";
    else if (a.startsWith("--tag=")) tag = a.slice("--tag=".length);
    else if (a.startsWith("--repeats=")) repeats = Math.max(1, parseInt(a.slice("--repeats=".length), 10) || 1);
    else if (a.startsWith("--out=")) outDir = a.slice("--out=".length);
  }
  const only: { model?: string; scenario?: string; lane?: "A" | "B" } = {};
  if (onlyModel !== undefined) only.model = onlyModel;
  if (onlyScenario !== undefined) only.scenario = onlyScenario;
  if (onlyLane !== undefined) only.lane = onlyLane;
  return { phase, sweep, only, ...(tag !== undefined ? { tag } : {}), repeats, outDir };
}

async function main(): Promise<void> {
  const { phase, sweep, only, tag, repeats, outDir } = parseArgs();
  console.log(`Output dir: ${resolve(process.cwd(), outDir)}`);
  const scenarios = loadScenarios();
  // If a single model is requested, use it verbatim (allows ad-hoc smoke
  // tests against models outside the locked sweep). Otherwise run the
  // sweep selected via --sweep=v0.5|v0.6 (default v0.5).
  const lockedSweep: ModelName[] =
    sweep === "v0.7"
      ? [...LOCKED_MODELS_V0_7]
      : sweep === "v0.6"
        ? [...LOCKED_MODELS_V0_6]
        : [...LOCKED_MODELS_V0_5];
  const models: ModelName[] = only.model ? [only.model as ModelName] : lockedSweep;
  for (const m of models) {
    if (!isPriced(m)) {
      console.warn(`  WARN: ${m} has no pricing entry — cost_usd will be 0 in results.`);
    }
  }
  const targets = only.scenario ? scenarios.filter((s) => s.id === only.scenario) : scenarios;

  // Lifecycle scenarios are multi-turn only — a single-turn trial cannot
  // exercise state evolution and would silently measure nothing.
  if (phase === "single" && targets.some(isLifecycle)) {
    const ids = targets.filter(isLifecycle).map((s) => s.id).join(", ");
    throw new Error(`lifecycle scenarios are multi-turn only (--phase=single requested): ${ids}`);
  }

  const phases: Phase[] = phase === "all" ? ["single", "multi"] : [phase];
  const lanes: Array<"A" | "B"> = only.lane ? [only.lane] : ["A", "B"];

  let done = 0;
  let skipped = 0;
  // Total includes repeats per cell.
  const total = models.length * targets.length * lanes.length * phases.length * repeats;
  if (tag) console.log(`Tag: ${tag} (results written as <model>+${tag}__...)`);
  if (repeats > 1) console.log(`Repeats: ${repeats} per cell (k=1 keeps legacy name, k>1 appended as __r<k>)`);
  console.log(`Running ${total} (model × scenario × lane × phase × repeats) combinations.`);

  for (const modelName of models) {
    const model = makeModel(modelName);

    for (const scenario of targets) {
      for (const lane of lanes) {
        for (const p of phases) {
          if (p === "single" && isLifecycle(scenario)) continue;
          for (let k = 1; k <= repeats; k++) {
            const outPath = resultPath(modelName, scenario.id, lane, p, tag, k, outDir);
            if (existsSync(outPath)) {
              skipped++;
              done++;
              continue;
            }

            const repeatLabel = repeats > 1 ? ` [repeat ${k}/${repeats}]` : "";
            const label = `${modelName} / ${scenario.id} / Lane ${lane} / ${p}${repeatLabel}`;
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

            // Persist repeat_index when running with --repeats>1.
            if (repeats > 1) {
              (result as RunResult & { repeat_index?: number }).repeat_index = k;
            }
            writeFileSync(outPath, JSON.stringify(result, null, 2));
            done++;
          }
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
