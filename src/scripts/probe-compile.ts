import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compileWplAi } from "@gymbile/wpl-ai";

const dir = resolve(process.cwd(), "results");
const files = readdirSync(dir).filter(f => f.includes("__B__") && !f.includes("+variant-") && f.endsWith(".json"));

interface Row {
  file: string;
  modelWeeks: number;
  modelPhases: number;
  compiledWeeks: number;
  compiledPhases: number;
  validationErrors: number;
  warnings: number;
  lost: number;
}
const rows: Row[] = [];
for (const f of files) {
  const r = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
  if (r.lane_b?.outcome !== "served") continue;
  const src = r.raw_text || "";
  const modelPhases = (src.match(/^\s*PHASE\s+/gm) || []).length;
  const modelWeeks = (src.match(/^\s*WEEK\s+\d+:/gm) || []).length;
  const compiled = compileWplAi(src);
  if (!compiled.ok) continue;
  const plan = (compiled.json as any).plan;
  const compiledPhases = plan.phases?.length || 0;
  const compiledWeeks = (plan.phases || []).reduce((s: number, p: any) => s + (p.weeks?.length || 0), 0);
  const validationErrors = compiled.validation?.errors?.length || 0;
  const warnings = compiled.warnings?.length || 0;
  rows.push({ file: f, modelWeeks, modelPhases, compiledWeeks, compiledPhases, validationErrors, warnings, lost: modelWeeks - compiledWeeks });
}

rows.sort((a, b) => b.lost - a.lost);
console.log("model_phases × model_weeks → compiled_phases × compiled_weeks   (warnings, val_errors)");
console.log("-".repeat(100));
for (const r of rows) {
  const flag = r.lost > 0 ? " ✗" : (r.modelWeeks > 0 && r.lost === 0 ? " ✓" : "");
  console.log(`  ${r.file.padEnd(58)} ${r.modelPhases}p×${r.modelWeeks}w → ${r.compiledPhases}p×${r.compiledWeeks}w   (W:${r.warnings} V:${r.validationErrors})${flag}`);
}

const droppedAny = rows.filter(r => r.lost > 0);
const cleanCompiles = rows.filter(r => r.modelWeeks > 0 && r.lost === 0);
console.log();
console.log(`Summary: ${droppedAny.length}/${rows.length} served-trials had weeks silently dropped during compile.`);
console.log(`Mean weeks lost (where lost > 0): ${(droppedAny.reduce((s, r) => s + r.lost, 0) / Math.max(1, droppedAny.length)).toFixed(1)}`);
console.log(`Cleanly compiled (model_weeks == compiled_weeks): ${cleanCompiles.length}/${rows.length}`);
