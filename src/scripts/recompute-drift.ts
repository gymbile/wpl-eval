// Recompute drift_turn for every Lane A multi-turn result using the
// current scorer. Stored drift_turn values were written at run-time and
// don't reflect later scorer fixes (intensity threshold, plural stemming,
// _any vs _anything wildcard semantics, single-token substring guard).
//
// Use after a scorer fix to refresh drift counts without re-spending on LLM.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { score } from "../scoring/blacklist.js";
import { firstDriftTurn } from "../scoring/drift.js";
import type { RunResult, Scenario } from "../lib/types.js";

const scenarioDoc = parseYaml(
  readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8"),
) as { scenarios: Scenario[] };
const scenarios: Record<string, Scenario> = {};
for (const s of scenarioDoc.scenarios) scenarios[s.id] = s;

const dir = resolve(process.cwd(), "results");
const files = readdirSync(dir).filter(
  (f) => f.endsWith(".json") && f.includes("__A__multi") && !f.includes("+"),
);

let totalDrift = 0;
let updated = 0;
const dist: Record<number, number> = {};
const changes: string[] = [];

for (const f of files) {
  const path = resolve(dir, f);
  const r = JSON.parse(readFileSync(path, "utf8")) as RunResult;
  if (r.error || !r.extracted_plans_per_turn) continue;
  const scenario = scenarios[r.scenario_id];
  if (!scenario) continue;

  const perTurnViolations = r.extracted_plans_per_turn.map((p) => score(scenario, p).violations);
  const newDrift = firstDriftTurn(perTurnViolations, scenario);
  const oldDrift = r.drift_turn;

  if (newDrift !== oldDrift) {
    changes.push(`  ${r.model}/${r.scenario_id}: ${oldDrift} → ${newDrift}`);
    r.drift_turn = newDrift;
    writeFileSync(path, JSON.stringify(r, null, 2));
    updated++;
  }
  if (newDrift !== null) {
    totalDrift++;
    dist[newDrift] = (dist[newDrift] ?? 0) + 1;
  }
}

console.log(`Re-evaluated ${files.length} multi-turn Lane A files: ${updated} drift values updated.`);
console.log(`\nFresh total drift cases: ${totalDrift}/40`);
console.log(`\nFresh drift-turn distribution:`);
for (const t of Object.keys(dist).map(Number).sort((a, b) => a - b)) {
  console.log(`  turn ${t}: ${dist[t]}`);
}
if (changes.length) {
  console.log(`\nChanges:`);
  for (const c of changes) console.log(c);
}
