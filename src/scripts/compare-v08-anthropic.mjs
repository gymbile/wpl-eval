// v0.8 Anthropic refresh vs the frozen v0.6 Anthropic corpus, apples-to-apples:
// blacklist-only unsafe-trial rate (exercise/intensity/food/session_start/
// required_missing kinds), per corpus (long-plan 15 / short-plan 5), phase, lane.
// Usage: node src/scripts/compare-v08-anthropic.mjs
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const BLACKLIST_KINDS = new Set(["exercise","intensity","food","session_start","required_missing"]);
const SHORT = new Set(["travel_hotel_2wk","peaking_powerlifting_3wk","postpartum_onramp_4wk","post_illness_recond_3wk","deload_1wk"]);
const RE = /^([a-z0-9.+_-]+?)(?:\+(v0\.6-[a-z]+))?__([a-z0-9_]+)__([AB])__(single|multi)(?:__r(\d+))?\.json$/;

function load(dir, keep) {
  const rows = [];
  for (const f of readdirSync(resolve(process.cwd(), dir))) {
    const m = f.match(RE); if (!m) continue;
    const [, model, tag, scenario, lane, phase] = m;
    if (!keep(model, tag)) continue;
    const r = JSON.parse(readFileSync(resolve(process.cwd(), dir, f), "utf8"));
    if (r.error) continue;
    const viols = r.violations ?? [];
    rows.push({
      model, scenario, lane, phase, corpus: SHORT.has(scenario) ? "short" : "long",
      blUnsafe: viols.some(v => BLACKLIST_KINDS.has(v.kind)),
      blViol: viols.filter(v => BLACKLIST_KINDS.has(v.kind)).length,
      allUnsafe: (r.safety_violations ?? 0) > 0,
      compile: r.wpl_valid === true, schema: r.wpl_schema_valid === true,
      drift: r.drift_turn != null && r.drift_turn > 1,
      refusal: !!r.refusal, cost: r.cost_usd ?? 0,
      kinds: viols.map(v => v.kind),
    });
  }
  return rows;
}

const v06 = load("results", (m, tag) => m.startsWith("claude-") && !!tag);
const v08 = load("results-v0.8", (m) => m.startsWith("claude-"));

function table(label, rows) {
  console.log(`\n==== ${label} (${rows.length} trials, $${rows.reduce((a,r)=>a+r.cost,0).toFixed(2)}) ====`);
  const models = [...new Set(rows.map(r => r.model))];
  for (const corpus of ["long","short"]) for (const phase of ["single","multi"]) {
    console.log(`\n-- ${corpus}-plan / ${phase} --`);
    console.log("model".padEnd(22)+"lane  n  bl-unsafe bl-viol all-unsafe compile schema drift refusal   cost");
    for (const model of models) for (const lane of ["A","B"]) {
      const s = rows.filter(r => r.model===model && r.corpus===corpus && r.phase===phase && r.lane===lane);
      if (!s.length) continue;
      const c = k => s.filter(r => r[k]).length;
      console.log(model.padEnd(22)+lane+"   "+String(s.length).padStart(2)+"  "+String(c("blUnsafe")).padStart(6)+"   "+String(s.reduce((a,r)=>a+r.blViol,0)).padStart(5)+"   "+String(c("allUnsafe")).padStart(6)+"   "+(lane==="B"?String(c("compile")).padStart(5)+"  "+String(c("schema")).padStart(5):"    —      —")+"   "+(phase==="multi"?String(c("drift")).padStart(3):"  —")+"   "+String(c("refusal")).padStart(4)+"   "+s.reduce((a,r)=>a+r.cost,0).toFixed(2).padStart(6));
    }
    for (const lane of ["A","B"]) {
      const s = rows.filter(r => r.corpus===corpus && r.phase===phase && r.lane===lane);
      const u = s.filter(r=>r.blUnsafe).length;
      console.log(`  TOTAL Lane ${lane}: blacklist-unsafe ${u}/${s.length} (${Math.round(100*u/s.length)}%)`+(lane==="B"?`  schema-valid ${s.filter(r=>r.schema).length}/${s.length}`:"")+(phase==="multi"?`  drift ${s.filter(r=>r.drift).length}/${s.length}`:""));
    }
  }
  const kinds = {};
  for (const r of rows.filter(r=>r.lane==="B")) for (const k of r.kinds) kinds[k]=(kinds[k]||0)+1;
  console.log("\nLane B violation kinds:", JSON.stringify(kinds));
  const kindsA = {};
  for (const r of rows.filter(r=>r.lane==="A")) for (const k of r.kinds) kindsA[k]=(kindsA[k]||0)+1;
  console.log("Lane A violation kinds:", JSON.stringify(kindsA));
}
table("v0.6 Anthropic (Claude 4.x, frozen)", v06);
table("v0.8 Anthropic (Claude 5.5)", v08);
