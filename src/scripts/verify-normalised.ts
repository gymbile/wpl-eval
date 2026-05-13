// Validate every results/*.json against the v1 normalised shape. Exits with
// status 1 on the first mismatch with a precise message. Run as a CI gate
// before tagging a release.
//
// Intentionally hand-rolled (no JSON Schema runtime) so the dependency
// footprint stays small and error messages can quote the exact failing
// field/path. Mirrors results/schema.json — keep them in sync.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const SCHEMA_VERSION = "1";
const pkgJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};
const EXPECTED_EVAL_VERSION = `v${pkgJson.version}`;

const resultsDir = resolve(process.cwd(), "results");
const files = readdirSync(resultsDir)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => f !== "schema.json");

const errors: string[] = [];

function require(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

for (const f of files) {
  try {
    const r = JSON.parse(readFileSync(resolve(resultsDir, f), "utf8")) as Record<string, unknown>;

    require(r.schemaVersion === SCHEMA_VERSION, `schemaVersion !== "${SCHEMA_VERSION}"`);
    require(
      r.evalVersion === EXPECTED_EVAL_VERSION,
      `evalVersion="${r.evalVersion}" expected="${EXPECTED_EVAL_VERSION}"`,
    );
    require(typeof r.model === "string" && r.model.length > 0, "model missing");
    require(typeof r.scenario_id === "string", "scenario_id missing");
    require(r.lane === "A" || r.lane === "B", `lane invalid: ${r.lane as string}`);
    require(r.phase === "single" || r.phase === "multi", `phase invalid: ${r.phase as string}`);
    require(typeof r.safety_violations === "number", "safety_violations missing");
    require(typeof r.clean_plan === "boolean", "clean_plan missing");
    require(typeof r.refusal === "boolean", "refusal missing");
    require(r.drift_turn === null || typeof r.drift_turn === "number", "drift_turn shape");
    require(Array.isArray(r.violations), "violations must be array");
    require(Array.isArray(r.violations_per_turn), "violations_per_turn must be array");

    for (const turnViols of r.violations_per_turn as unknown[]) {
      require(Array.isArray(turnViols), "violations_per_turn[i] must be array");
      for (const v of turnViols as Record<string, unknown>[]) {
        require(typeof v.kind === "string", "violation.kind missing");
        require(typeof v.item === "string", "violation.item missing");
      }
    }

    if (r.lane === "B") {
      const lb = r.lane_b as Record<string, unknown> | null;
      require(lb !== null && typeof lb === "object", "Lane B: lane_b envelope missing");
      const outcome = (lb as Record<string, unknown>).outcome;
      require(
        outcome === "served" ||
          outcome === "compile_failed" ||
          outcome === "stripped_clean" ||
          outcome === "stripped_with_residual",
        `lane_b.outcome invalid: ${outcome as string}`,
      );
    } else {
      // Lane A trials should have lane_b === null
      require(r.lane_b === null || r.lane_b === undefined, "Lane A: lane_b should be null");
    }

    require(typeof r.timestamp === "string", "timestamp missing");
  } catch (e) {
    errors.push(`  ${f}: ${(e as Error).message}`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} file(s) failed schema verification:`);
  for (const e of errors) console.error(e);
  process.exit(1);
}

console.log(`✓ All ${files.length} result files validate against schema v${SCHEMA_VERSION} at ${EXPECTED_EVAL_VERSION}.`);
