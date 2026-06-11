// Comprehensive headline tabulator across ALL corpora, both phases, both lanes.
// Reads results/ directly. Output is grouped by corpus → phase → lane → model.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve(process.cwd(), "results");
const files = readdirSync(dir).filter(
  (f) => f.endsWith(".json") && !f.startsWith("smoketest") && f.includes("__"),
);

function classify(f) {
  const name = f.replace(".json", "");
  // model+tag__scenario__lane__phase  OR  model__scenario__lane__phase
  const m = name.match(
    /^([a-z0-9.+_-]+?)(?:\+(v0\.6-[a-z]+))?__([a-z0-9_]+)__([AB])__(single|multi)$/,
  );
  if (!m) return null;
  const [, model, tag, scenario, lane, phase] = m;
  let corpus;
  if (tag === undefined) corpus = "v0.5-openai-longplan";
  else if (["v0.6-haiku", "v0.6-sonnet", "v0.6-opus"].includes(tag)) corpus = "v0.6-anthropic-longplan";
  else if (tag === "v0.6-shortplans") corpus = "v0.6-shortplan";
  else return null;
  return { model, corpus, scenario, lane, phase };
}

const groups = new Map();
for (const f of files) {
  const c = classify(f);
  if (!c) continue;
  const r = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  const key = `${c.corpus}|${c.phase}|${c.lane}|${c.model}`;
  if (!groups.has(key))
    groups.set(key, {
      ...c,
      n: 0, err: 0, refusal: 0,
      compile: 0, schema: 0,
      unsafe: 0, totalViol: 0,
      drift: 0, walked: 0,
      cost: 0,
    });
  const g = groups.get(key);
  g.n++;
  if (r.error) { g.err++; continue; }
  if (r.refusal) g.refusal++;
  if (r.wpl_valid === true) g.compile++;
  if (r.wpl_schema_valid === true) g.schema++;
  if ((r.safety_violations ?? 0) > 0) g.unsafe++;
  g.totalViol += r.safety_violations ?? 0;
  if (r.drift_turn !== null && r.drift_turn !== undefined && r.drift_turn > 1) g.drift++;
  if (r.latest_valid_turn !== null && r.latest_valid_turn !== undefined && r.latest_valid_turn !== 8) g.walked++;
  g.cost += r.cost_usd ?? 0;
}

// Aggregate helpers
function agg(rows) {
  return rows.reduce((a, r) => ({
    n: a.n + r.n, err: a.err + r.err,
    compile: a.compile + r.compile, schema: a.schema + r.schema,
    unsafe: a.unsafe + r.unsafe, totalViol: a.totalViol + r.totalViol,
    drift: a.drift + r.drift, walked: a.walked + r.walked, cost: a.cost + r.cost,
  }), { n:0,err:0,compile:0,schema:0,unsafe:0,totalViol:0,drift:0,walked:0,cost:0 });
}

const rows = [...groups.values()];
const corpora = [...new Set(rows.map((r) => r.corpus))].sort();
const modelOrder = ["gpt-5","gpt-5-mini","gpt-5-nano","gpt-4.1","claude-haiku-4-5-20251001","claude-sonnet-4-6","claude-opus-4-7"];
const ms = (m) => { const i = modelOrder.indexOf(m); return i === -1 ? 99 : i; };

const w = (s, n) => String(s).padStart(n);
const wl = (s, n) => String(s).padEnd(n);

for (const corpus of corpora) {
  console.log("\n\n############ " + corpus + " ############");
  for (const phase of ["single", "multi"]) {
    console.log("\n--- " + phase + "-turn ---");
    console.log([wl("model",28),wl("lane",5),w("n",4),w("comp",6),w("schema",7),w("unsafe",7),w("tViol",7),w("drift",6),w("walk",5),w("cost$",8)].join(" "));
    const sub = rows.filter((r) => r.corpus === corpus && r.phase === phase).sort((a,b)=>ms(a.model)-ms(b.model)||a.lane.localeCompare(b.lane));
    for (const r of sub) {
      console.log([
        wl(r.model,28), wl(r.lane,5), w(r.n,4),
        r.lane==="B"?w(r.compile,6):w("—",6),
        r.lane==="B"?w(r.schema,7):w("—",7),
        w(r.unsafe,7), w(r.totalViol,7),
        phase==="multi"?w(r.drift,6):w("—",6),
        (r.lane==="B"&&phase==="multi")?w(r.walked,5):w("—",5),
        w(r.cost.toFixed(2),8),
      ].join(" "));
    }
    // Lane A vs B aggregate for this corpus+phase
    const A = agg(sub.filter((r)=>r.lane==="A"));
    const B = agg(sub.filter((r)=>r.lane==="B"));
    console.log(wl("  TOTAL Lane A",33) + w(A.unsafe+"/"+A.n+" unsafe",18) + "  " + w(A.totalViol+" viol",12));
    console.log(wl("  TOTAL Lane B",33) + w(B.unsafe+"/"+B.n+" unsafe",18) + "  " + w(B.totalViol+" viol",12) + "  compile " + B.compile+"/"+B.n);
  }
}

// Grand cost
const total = agg(rows);
console.log("\n\n=== GRAND TOTALS ===");
console.log("trials: " + total.n + "  (errors: " + total.err + ")");
console.log("total inference cost: $" + total.cost.toFixed(2));
