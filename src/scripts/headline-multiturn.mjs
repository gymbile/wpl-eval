// Tabulate post-option-B multi-turn headline metrics.
// Walks results/ directly so it doesn't depend on shell glob expansion.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const dir = resolve(process.cwd(), "results");
const files = readdirSync(dir).filter(
  (f) => f.endsWith("__multi.json") && !f.startsWith("smoketest"),
);

function bucket(f) {
  const name = f.replace(".json", "");
  const m = name.match(/^([a-z0-9.+_-]+?)(?:\+(v0\.6-[a-z]+))?__([a-z0-9_]+)__([AB])__multi$/);
  if (!m) return null;
  const [, model, tag, scenario, lane] = m;
  let slice;
  if (tag === undefined) slice = "v0.5-openai";
  else if (tag === "v0.6-haiku" || tag === "v0.6-sonnet" || tag === "v0.6-opus")
    slice = "v0.6-anthropic";
  else if (tag === "v0.6-shortplans") slice = "v0.6-shortplans";
  else slice = `unknown:${tag}`;
  return { model, slice, scenario, lane };
}

const groups = new Map();
for (const f of files) {
  const b = bucket(f);
  if (!b) continue;
  const r = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  if (r.error || r.refusal) continue;
  const key = `${b.slice}|${b.model}|${b.lane}`;
  if (!groups.has(key))
    groups.set(key, {
      slice: b.slice,
      model: b.model,
      lane: b.lane,
      n: 0,
      compile: 0,
      schema: 0,
      unsafe: 0,
      walked_back: 0,
      drift: 0,
    });
  const g = groups.get(key);
  g.n++;
  if (r.wpl_valid === true) g.compile++;
  if (r.wpl_schema_valid === true) g.schema++;
  if ((r.safety_violations ?? 0) > 0) g.unsafe++;
  if (
    r.latest_valid_turn !== null &&
    r.latest_valid_turn !== undefined &&
    r.latest_valid_turn !== 8
  )
    g.walked_back++;
  if (r.drift_turn !== null && r.drift_turn !== undefined && r.drift_turn > 1) g.drift++;
}

const rows = [...groups.values()].sort(
  (a, b) =>
    a.slice.localeCompare(b.slice) ||
    a.model.localeCompare(b.model) ||
    a.lane.localeCompare(b.lane),
);

const w = (s, n) => String(s).padStart(n);
console.log(
  [
    "slice".padEnd(18),
    "model".padEnd(28),
    "lane".padEnd(5),
    w("n", 4),
    w("comp", 8),
    w("schema", 8),
    w("unsafe", 8),
    w("walked", 8),
    w("drift", 8),
  ].join(" "),
);
console.log("-".repeat(110));
for (const r of rows) {
  console.log(
    [
      r.slice.padEnd(18),
      r.model.padEnd(28),
      r.lane.padEnd(5),
      w(r.n, 4),
      r.lane === "B" ? w(r.compile, 8) : w("—", 8),
      r.lane === "B" ? w(r.schema, 8) : w("—", 8),
      w(r.unsafe, 8),
      r.lane === "B" ? w(r.walked_back, 8) : w("—", 8),
      w(r.drift, 8),
    ].join(" "),
  );
}
