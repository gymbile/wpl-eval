// One-off analyser: for a list of (model, scenario, lane) result files,
// re-score each turn's extracted plan against the real blacklist and print
// where drift introduced new violations.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { score } from "../scoring/blacklist.js";
import type { Scenario, RunResult, Violation } from "../lib/types.js";

const scenarioDoc = parseYaml(
  readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8"),
) as { scenarios: Scenario[] };
const scenarios: Record<string, Scenario> = {};
for (const s of scenarioDoc.scenarios) scenarios[s.id] = s;

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: drift-detail <result.json> ...");
  process.exit(2);
}

const violationKey = (v: Violation) => `${v.kind}:${v.item}`;

for (const f of files) {
  const r = JSON.parse(readFileSync(resolve(process.cwd(), f), "utf8")) as RunResult;
  const scenario = scenarios[r.scenario_id]!;
  const plansPerTurn = r.extracted_plans_per_turn ?? [];
  const rawsPerTurn = r.raw_texts_per_turn ?? [];

  console.log(`\n========== ${r.model} / ${r.scenario_id} / Lane ${r.lane} ==========`);
  console.log(`drift_turn (stored): ${r.drift_turn}`);
  console.log(`final safety_violations: ${r.safety_violations}`);

  const turn1Set = new Set<string>();
  for (let i = 0; i < plansPerTurn.length; i++) {
    const plan = plansPerTurn[i]!;
    const result = score(scenario, plan);
    const keys = new Set(result.violations.map(violationKey));
    if (i === 0) {
      for (const k of keys) turn1Set.add(k);
    }

    const fresh = result.violations.filter((v) => !turn1Set.has(violationKey(v)));
    const carry = result.violations.filter((v) => turn1Set.has(violationKey(v)));

    if (result.violations.length === 0) {
      console.log(`  turn ${i + 1}: clean  (text ${rawsPerTurn[i]?.length ?? 0} chars)`);
    } else {
      console.log(
        `  turn ${i + 1}: ${result.violations.length} hits  (text ${rawsPerTurn[i]?.length ?? 0} chars)  fresh=${fresh.length} carry=${carry.length}`,
      );
      for (const v of fresh.slice(0, 6)) {
        console.log(`    NEW  [${v.kind}] ${v.item}${v.week ? ` w${v.week}` : ""}${v.detail ? " — " + v.detail : ""}`);
      }
      for (const v of carry.slice(0, 3)) {
        console.log(`    carry [${v.kind}] ${v.item}`);
      }
    }
  }
}
