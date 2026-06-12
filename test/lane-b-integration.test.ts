import { describe, it, expect } from "vitest";
import { compileWplAi } from "@gymbile/wpl-ai";
import { extractFromWplJson } from "../src/lanes/lane-b.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// INVARIANT: if the compiler succeeded on DSL containing exercises, the
// Lane B walker MUST see them. A successful compile + empty extraction is
// exactly the measurement bug that caused the v0.6 retraction ("0/180
// Anthropic Lane B violations" that turned out to be "walker saw nothing").
//
// Corpus: wpl/conformance/compile/fixtures — 149 source.wpl files organised
// as fixtures/<category>/<name>/source.wpl. Each file is a DSL source that
// the wpl-ai compiler must accept. The compiled JSON shape is:
//   { plan: { phases: [ { weeks: [ { days: [ { blocks: [ { activities: [ {
//     exercise_ref, name, ... } ] } ] } ] } ] } ] } }
// The walker reads plan.phases[].weeks[].days[].blocks[].activities[] and
// collects any activity that has exercise_ref or name.
// ---------------------------------------------------------------------------

const _testDir = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_DIR =
  process.env["WPL_CONFORMANCE_DIR"] ??
  join(_testDir, "../../../wpl/conformance/compile/fixtures");

// Recursively find all source.wpl files (one level of subdirectory nesting:
// FIXTURE_DIR/<category>/<fixture-name>/source.wpl).
const allWplFiles = readdirSync(FIXTURE_DIR)
  .flatMap((category) => {
    const categoryPath = join(FIXTURE_DIR, category);
    try {
      return readdirSync(categoryPath).map((name) =>
        join(category, name, "source.wpl")
      );
    } catch {
      return [];
    }
  })
  .filter((relPath) => relPath.endsWith("source.wpl"));

// ---------------------------------------------------------------------------
// Helper: count named/ref activities in a successfully-compiled plan JSON.
// Only activities inside plan.phases[].weeks[].days[].blocks[].activities[]
// that carry exercise_ref OR name are counted — this avoids false positives
// from exercise_ref appearing in other sections (e.g. one_rm thresholds).
// ---------------------------------------------------------------------------
function countActivities(json: Record<string, unknown>): number {
  const plan =
    typeof json["plan"] === "object" && json["plan"] !== null
      ? (json["plan"] as Record<string, unknown>)
      : json;
  const phases = Array.isArray(plan["phases"])
    ? (plan["phases"] as Record<string, unknown>[])
    : [];
  let count = 0;
  for (const phase of phases) {
    const weeks = Array.isArray(phase["weeks"])
      ? (phase["weeks"] as Record<string, unknown>[])
      : [];
    for (const week of weeks) {
      const days = Array.isArray(week["days"])
        ? (week["days"] as Record<string, unknown>[])
        : [];
      for (const day of days) {
        const blocks = Array.isArray(day["blocks"])
          ? (day["blocks"] as Record<string, unknown>[])
          : [];
        for (const block of blocks) {
          const activities = Array.isArray(block["activities"])
            ? (block["activities"] as Record<string, unknown>[])
            : [];
          for (const activity of activities) {
            if (
              typeof activity["exercise_ref"] === "string" ||
              typeof activity["name"] === "string"
            ) {
              count++;
            }
          }
        }
      }
    }
  }
  return count;
}

describe("compile -> extract invariant", () => {
  it("found fixtures to test against", () => {
    // 149 confirmed in the corpus; use 40 as honest minimum.
    expect(allWplFiles.length).toBeGreaterThan(40);
  });

  // Census guard: ensures the per-fixture invariant tests are NOT vacuously
  // passing because the compiler regressed or the corpus changed so that no
  // fixture compiles-with-activities. The real count is 84 (as of 2026-06);
  // threshold is set to 42 (half) so normal corpus churn doesn't false-alarm.
  it("census: meaningful number of fixtures both compiled and had activities", () => {
    let compiledWithActivities = 0;
    for (const relPath of allWplFiles) {
      const src = readFileSync(join(FIXTURE_DIR, relPath), "utf8");
      const r = compileWplAi(src);
      if (!r.ok) continue;
      if (countActivities(r.json) > 0) compiledWithActivities++;
    }
    expect(
      compiledWithActivities,
      `Expected at least 42 fixtures to compile AND have activities, ` +
        `but only ${compiledWithActivities} did. The per-fixture invariant ` +
        `assertions may be silently vacuous.`
    ).toBeGreaterThanOrEqual(42);
  });

  for (const relPath of allWplFiles) {
    it(`walker sees what the compiler emitted: ${relPath}`, () => {
      const src = readFileSync(join(FIXTURE_DIR, relPath), "utf8");
      const r = compileWplAi(src);

      // Parser/compiler errors are out of scope — those fixtures test error
      // reporting, not the walker.
      if (!r.ok) return;

      const extracted = extractFromWplJson(r.json);

      // Only assert when the compiled plan actually contains exercise
      // activities — avoids false positives from exercise_ref in other
      // sections (e.g. plan.athlete_thresholds.one_rm[].exercise_ref).
      const activityCount = countActivities(r.json);

      if (activityCount > 0) {
        const plan =
          typeof r.json["plan"] === "object" && r.json["plan"] !== null
            ? (r.json["plan"] as Record<string, unknown>)
            : r.json;
        expect(
          extracted.exercises.length,
          `compile ok but walker extracted 0 exercises from ${relPath} ` +
            `even though the compiled plan contains ${activityCount} named/ref activities. ` +
            `JSON keys at root: ${Object.keys(r.json).join(", ")}. ` +
            `plan keys: ${Object.keys(plan).join(", ")}.`
        ).toBeGreaterThan(0);
      }
    });
  }
});
