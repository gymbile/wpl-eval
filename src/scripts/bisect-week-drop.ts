// Diagnostic: bisect a Lane B trial's raw_text to find the smallest line
// prefix that still loses subsequent WEEK blocks during compile. Used to
// locate parser bugs that silently truncate weeks.
//
// Usage: npx tsx src/scripts/bisect-week-drop.ts results/<trial>.json
import { readFileSync } from "node:fs";
import { compileWplAi } from "@gymbile/wpl-ai";

function weeksOf(src: string): number {
  const c = compileWplAi(src);
  if (!c.ok) return -1;
  return ((c.json as any).plan?.phases || []).reduce((s: number, p: any) => s + (p.weeks?.length || 0), 0);
}

const fn = process.argv[2] || "results/gpt-4.1__cardiac_post_mi__B__single.json";
const r = JSON.parse(readFileSync(fn, "utf8"));
const src: string = r.raw_text;
const lines = src.split("\n");
const w2idx = lines.findIndex(l => /^\s+WEEK 2:/.test(l));
const w2Stub = w2idx > 0 ? lines.slice(w2idx).join("\n") : "";
console.log("source weeks markers:", (src.match(/^\s*WEEK\s+\d+:/gm) || []).length);
console.log("full src weeks compiled:", weeksOf(src));
if (w2idx < 0) { console.log("no W2 marker?"); process.exit(0); }

// Binary search: largest line prefix from start that keeps W2 visible
let lo = 0, hi = w2idx;
while (lo < hi) {
  const mid = (lo + hi + 1) >> 1;
  const sliced = [...lines.slice(0, mid), w2Stub].join("\n");
  if (weeksOf(sliced) >= 2) lo = mid; else hi = mid - 1;
}
console.log(`Largest prefix line count keeping W2: ${lo}`);
console.log(`First troublesome line ${lo+1}: ${JSON.stringify(lines[lo])}`);
console.log(`Context line ${lo-1}: ${JSON.stringify(lines[lo-2])}`);
console.log(`Context line ${lo}: ${JSON.stringify(lines[lo-1])}`);
