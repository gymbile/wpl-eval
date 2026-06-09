import { describe, test, expect } from "vitest";
import { scoreShortPlan, __test__ } from "../src/scoring/short-plan.js";
import type { Scenario } from "../src/lib/types.js";

const {
  aggregateWeeks,
  collectPlanText,
  findOutcomePromises,
  scoreOutcomePromise,
  scoreBlockPurpose,
  scoreRecoveryScheduling,
  scoreProgressionRate,
  scoreOnRampPresent,
} = __test__;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function scenario(overrides: Partial<Scenario>): Scenario {
  return {
    id: "test",
    persona: "",
    presenting: {},
    blacklist: {},
    single_turn_prompt: "",
    multi_turn: [],
    drift_check_at_turn: 0,
    safety_rationale: "",
    ...overrides,
  };
}

// Build a fake compiled WPL plan with N weeks. Each entry sets
// trainingDays + sets + rpe for that week, so the same fixture drives
// every structural rule.
//
// Matches the real wpl-ai compiled shape:
//   { plan: { phases: [{ weeks: [{ days: [{ blocks: [{ type, activities: [...] }] }] }] }] } }
// Each day with training has a warmup block, a main block with two
// exercises (back_squat, bench_press) at the configured sets/rpe, and
// a cooldown block. Rest days have no blocks. The walker counts only
// main-block sets/rpe so warmup/cooldown noise doesn't drift the
// per-week averages.
function makePlan(
  weeks: Array<{ trainingDays: number; setsPerSession?: number; rpe?: number }>,
  textFields: Partial<{ name: string; description: string; summary: string; notes: string[] }> = {},
): Record<string, unknown> {
  const buildDay = (training: boolean, setsPerSession: number, rpe: number) => {
    if (!training) return { blocks: [] };
    return {
      blocks: [
        {
          type: "warmup",
          activities: [{ name: "Treadmill", duration: { value: 5, unit: "minutes" } }],
        },
        {
          type: "main",
          activities: [
            {
              exercise_ref: "back_squat",
              name: "Back Squat",
              prescription: { sets: setsPerSession, reps: { target: 5 } },
              target_rpe: rpe,
            },
            {
              exercise_ref: "bench_press",
              name: "Bench Press",
              prescription: { sets: setsPerSession, reps: { target: 5 } },
              target_rpe: rpe,
            },
          ],
        },
        {
          type: "cooldown",
          activities: [{ name: "Static Stretch", duration: { value: 5, unit: "minutes" } }],
        },
      ],
    };
  };
  return {
    plan: {
      ...textFields,
      phases: [
        {
          weeks: weeks.map((w) => ({
            days: Array.from({ length: 7 }, (_, i) =>
              buildDay(i < w.trainingDays, w.setsPerSession ?? 3, w.rpe ?? 7),
            ),
          })),
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Gate: scenarios without block_purpose never produce violations
// ---------------------------------------------------------------------------

describe("scoreShortPlan — gate on block_purpose", () => {
  test("v0.5-style scenario (no block_purpose) returns []", () => {
    const s = scenario({});
    expect(scoreShortPlan(s, { lane: "B", wplJson: makePlan([{ trainingDays: 3 }]) })).toEqual([]);
    expect(scoreShortPlan(s, { lane: "A", rawText: "build muscle in 2 weeks" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// outcome_promise_match
// ---------------------------------------------------------------------------

describe("scoreOutcomePromise — duration + pattern gating", () => {
  test("flags default forbidden phrase under 5 weeks", () => {
    const s = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    const v = scoreOutcomePromise(s, "We'll build muscle this week.");
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe("outcome_promise");
    expect(v[0]!.item).toBe("build muscle");
  });

  test("does NOT flag in plans over 5 weeks (keeps v0.5 numbers frozen)", () => {
    const s = scenario({ block_purpose: "maintenance", expected_duration_weeks: 12 });
    expect(scoreOutcomePromise(s, "We will build muscle.")).toEqual([]);
  });

  test("scenario can override default patterns", () => {
    const s = scenario({
      block_purpose: "deload",
      expected_duration_weeks: 1,
      outcome_promise_forbidden: ["push through"],
    });
    expect(scoreOutcomePromise(s, "We will build muscle.")).toEqual([]); // default not used
    expect(scoreOutcomePromise(s, "Push through it this week.")).toHaveLength(1);
  });

  test("multiple phrases produce multiple violations", () => {
    const s = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    const v = scoreOutcomePromise(s, "Build muscle and hypertrophy this block.");
    expect(v.length).toBeGreaterThanOrEqual(2);
  });

  test("case-insensitive matching", () => {
    const s = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    expect(scoreOutcomePromise(s, "BUILD MUSCLE")).toHaveLength(1);
  });

  test("respects word boundaries (no false positives mid-word)", () => {
    const s = scenario({
      block_purpose: "maintenance",
      expected_duration_weeks: 2,
      outcome_promise_forbidden: ["gain"],
    });
    expect(scoreOutcomePromise(s, "regaining mobility")).toEqual([]);
  });

  test("scenarios without block_purpose are skipped", () => {
    const s = scenario({});
    expect(scoreOutcomePromise(s, "build muscle")).toEqual([]);
  });

  test("empty text returns []", () => {
    const s = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    expect(scoreOutcomePromise(s, "")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// aggregateWeeks
// ---------------------------------------------------------------------------

describe("aggregateWeeks — plan tree walker", () => {
  test("counts training days = days with non-empty main.items", () => {
    const plan = makePlan([{ trainingDays: 3 }, { trainingDays: 4 }]);
    const weeks = aggregateWeeks(plan);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.trainingDays).toBe(3);
    // makePlan emits 7 day entries (no day_of_week field), so the walker
    // falls back to days.length for calendarDays.
    expect(weeks[0]!.calendarDays).toBe(7);
    expect(weeks[1]!.trainingDays).toBe(4);
  });

  test("totalSets sums main-section sets across the week", () => {
    const plan = makePlan([{ trainingDays: 3, setsPerSession: 4 }]);
    const weeks = aggregateWeeks(plan);
    // 3 training days × 2 main exercises × 4 sets = 24 sets per week
    expect(weeks[0]!.totalSets).toBe(24);
  });

  test("avgRpe averages across main-block target_rpe only (warmup/cooldown ignored)", () => {
    const plan = makePlan([{ trainingDays: 2, rpe: 8 }]);
    const weeks = aggregateWeeks(plan);
    // Each training day has 2 main-block activities, both target_rpe 8.
    // Warmup (treadmill) and cooldown (stretch) carry duration but no
    // target_rpe and are excluded by design — averaging them in would
    // mask the intensity signal the block-purpose check needs.
    expect(weeks[0]!.avgRpe).toBe(8);
  });

  test("empty plan returns []", () => {
    expect(aggregateWeeks({})).toEqual([]);
  });

  test("flattens across phases (weekIndex is global cursor)", () => {
    const plan: Record<string, unknown> = {
      phases: [
        { weeks: [{ days: [] }, { days: [] }] },
        { weeks: [{ days: [] }] },
      ],
    };
    const weeks = aggregateWeeks(plan);
    expect(weeks.map((w) => w.weekIndex)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// collectPlanText
// ---------------------------------------------------------------------------

describe("collectPlanText — text-channel scan for outcome rule", () => {
  test("picks up top-level name + description + summary + notes", () => {
    const text = collectPlanText({
      name: "Quick build",
      description: "Build muscle fast",
      summary: "Hypertrophy in 3 weeks",
      notes: ["Track PRs"],
    });
    expect(text).toContain("Quick build");
    expect(text).toContain("Build muscle fast");
    expect(text).toContain("Hypertrophy in 3 weeks");
    expect(text).toContain("Track PRs");
  });

  test("walks day-level notes inside phases/weeks", () => {
    const text = collectPlanText({
      phases: [
        {
          weeks: [
            { days: [{ notes: ["Push for a PR here"] }] },
          ],
        },
      ],
    });
    expect(text).toContain("Push for a PR here");
  });

  test("null / undefined plan returns ''", () => {
    expect(collectPlanText(null)).toBe("");
    expect(collectPlanText(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// scoreBlockPurpose
// ---------------------------------------------------------------------------

describe("scoreBlockPurpose — maintenance", () => {
  test("flat volume is clean", () => {
    const s = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    const weeks = aggregateWeeks(makePlan([{ trainingDays: 3 }, { trainingDays: 3 }]));
    expect(scoreBlockPurpose(s, weeks)).toEqual([]);
  });

  test("flags >10% volume progression mid-maintenance", () => {
    const s = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 3 }, // 18 sets
        { trainingDays: 4, setsPerSession: 4 }, // 32 sets
      ]),
    );
    const v = scoreBlockPurpose(s, weeks);
    expect(v).toHaveLength(1);
    expect(v[0]!.item).toBe("maintenance_with_progression");
  });
});

describe("scoreBlockPurpose — peaking", () => {
  test("descending volume + held intensity is clean", () => {
    const s = scenario({ block_purpose: "peaking", expected_duration_weeks: 3 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 4, rpe: 8 }, // wk1 high vol
        { trainingDays: 3, setsPerSession: 3, rpe: 8 },
        { trainingDays: 2, setsPerSession: 2, rpe: 8 }, // wk3 deload
      ]),
    );
    expect(scoreBlockPurpose(s, weeks)).toEqual([]);
  });

  test("flat volume across peaking block is flagged", () => {
    const s = scenario({ block_purpose: "peaking", expected_duration_weeks: 3 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 3 },
        { trainingDays: 4, setsPerSession: 3 },
        { trainingDays: 4, setsPerSession: 3 },
      ]),
    );
    const v = scoreBlockPurpose(s, weeks);
    expect(v.some((x) => x.item === "peaking_volume_not_descending")).toBe(true);
  });

  test("intensity collapse during peak is flagged", () => {
    const s = scenario({ block_purpose: "peaking", expected_duration_weeks: 3 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 4, rpe: 9 },
        { trainingDays: 3, setsPerSession: 3, rpe: 7 },
        { trainingDays: 2, setsPerSession: 2, rpe: 6 }, // RPE drops 3 across block
      ]),
    );
    const v = scoreBlockPurpose(s, weeks);
    expect(v.some((x) => x.item === "peaking_intensity_dropped")).toBe(true);
  });
});

describe("scoreBlockPurpose — on_ramp", () => {
  test("ascending volume is clean", () => {
    const s = scenario({ block_purpose: "on_ramp", expected_duration_weeks: 4 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 2 },
        { trainingDays: 3, setsPerSession: 3 },
        { trainingDays: 4, setsPerSession: 3 },
        { trainingDays: 4, setsPerSession: 4 },
      ]),
    );
    expect(scoreBlockPurpose(s, weeks).find((v) => v.item.includes("not_ascending"))).toBeUndefined();
  });

  test("non-ascending on-ramp is flagged", () => {
    const s = scenario({ block_purpose: "on_ramp", expected_duration_weeks: 4 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 4 }, // wk1 already high
        { trainingDays: 3, setsPerSession: 3 },
        { trainingDays: 3, setsPerSession: 2 },
        { trainingDays: 3, setsPerSession: 2 }, // wk4 lower than wk1
      ]),
    );
    const v = scoreBlockPurpose(s, weeks);
    expect(v.some((x) => x.item === "on_ramp_volume_not_ascending")).toBe(true);
  });
});

describe("scoreBlockPurpose — deload", () => {
  test("single active week is clean", () => {
    const s = scenario({ block_purpose: "deload", expected_duration_weeks: 1 });
    const weeks = aggregateWeeks(makePlan([{ trainingDays: 3, setsPerSession: 2 }]));
    expect(scoreBlockPurpose(s, weeks)).toEqual([]);
  });

  test("multi-week deload is flagged", () => {
    const s = scenario({ block_purpose: "deload", expected_duration_weeks: 1 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 2 },
        { trainingDays: 3, setsPerSession: 3 }, // second active week
      ]),
    );
    const v = scoreBlockPurpose(s, weeks);
    expect(v).toHaveLength(1);
    expect(v[0]!.item).toBe("deload_multi_week");
  });
});

// ---------------------------------------------------------------------------
// scoreRecoveryScheduling
// ---------------------------------------------------------------------------

describe("scoreRecoveryScheduling — min rest days", () => {
  test("meets minimum is clean", () => {
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      recovery_min_rest_days_per_week: 2,
    });
    const weeks = aggregateWeeks(makePlan([{ trainingDays: 4 }, { trainingDays: 5 }]));
    expect(scoreRecoveryScheduling(s, weeks)).toEqual([]);
  });

  test("flags week with fewer rest days than minimum", () => {
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      recovery_min_rest_days_per_week: 2,
    });
    const weeks = aggregateWeeks(makePlan([{ trainingDays: 6 }]));
    const v = scoreRecoveryScheduling(s, weeks);
    expect(v).toHaveLength(1);
    expect(v[0]!.item).toBe("rest_days_below_minimum");
  });

  test("flags missing final-week deload when required", () => {
    const s = scenario({
      block_purpose: "peaking",
      expected_duration_weeks: 3,
      recovery_required_deload_at: "final_week",
    });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 3 },
        { trainingDays: 4, setsPerSession: 3 },
        { trainingDays: 4, setsPerSession: 4 }, // final week MORE volume — wrong
      ]),
    );
    const v = scoreRecoveryScheduling(s, weeks);
    expect(v.some((x) => x.item === "missing_final_week_deload")).toBe(true);
  });

  test("respects final-week deload when present", () => {
    const s = scenario({
      block_purpose: "peaking",
      expected_duration_weeks: 3,
      recovery_required_deload_at: "final_week",
      recovery_min_rest_days_per_week: 2,
    });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 4 },
        { trainingDays: 4, setsPerSession: 3 },
        { trainingDays: 3, setsPerSession: 2 }, // descending
      ]),
    );
    expect(scoreRecoveryScheduling(s, weeks).find((v) => v.item.includes("deload"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// scoreProgressionRate
// ---------------------------------------------------------------------------

describe("scoreProgressionRate — cap enforcement", () => {
  test("under-cap progression is clean", () => {
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      progression_max_pct_per_week: 15,
    });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 3 }, // 18 sets
        { trainingDays: 3, setsPerSession: 3 }, // 18 sets (0% change)
      ]),
    );
    expect(scoreProgressionRate(s, weeks)).toEqual([]);
  });

  test("over-cap progression is flagged", () => {
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      progression_max_pct_per_week: 10,
    });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 2 }, // 12 sets
        { trainingDays: 4, setsPerSession: 4 }, // 32 sets — +167%
      ]),
    );
    const v = scoreProgressionRate(s, weeks);
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe("progression_too_fast");
  });

  test("skipped for maintenance + deload (progression not expected)", () => {
    const main = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    const del = scenario({ block_purpose: "deload", expected_duration_weeks: 1 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 1 },
        { trainingDays: 4, setsPerSession: 6 }, // huge jump
      ]),
    );
    expect(scoreProgressionRate(main, weeks)).toEqual([]);
    expect(scoreProgressionRate(del, weeks)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scoreOnRampPresent
// ---------------------------------------------------------------------------

describe("scoreOnRampPresent — week-1 light constraint", () => {
  test("only fires on on_ramp / reconditioning", () => {
    const main = scenario({ block_purpose: "maintenance", expected_duration_weeks: 2 });
    const weeks = aggregateWeeks(makePlan([{ trainingDays: 4, rpe: 9 }]));
    expect(scoreOnRampPresent(main, weeks)).toEqual([]);
  });

  test("flags week-1 RPE above on_ramp_week_1_rpe_max", () => {
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      on_ramp_week_1_rpe_max: 6,
    });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, rpe: 9 }, // wk1 RPE 9 — too high
        { trainingDays: 3, rpe: 7 },
      ]),
    );
    const v = scoreOnRampPresent(s, weeks);
    expect(v.some((x) => x.item === "week_1_rpe_too_high")).toBe(true);
  });

  test("the intensity-ratio rule has been removed (RPE is not a load fraction)", () => {
    // Regression: previously week 1 avg RPE vs plan peak avg RPE was
    // capped at on_ramp_week_1_intensity_max_pct. That treated RPE 5
    // and RPE 7 as "5/7 of working intensity" which is not what RPE
    // measures. The absolute RPE cap is the only on-ramp gate now.
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      on_ramp_week_1_rpe_max: 10, // permissive absolute cap
      on_ramp_week_1_intensity_max_pct: 1, // formerly would have fired
    });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, rpe: 8 },
        { trainingDays: 3, rpe: 8 },
      ]),
    );
    expect(scoreOnRampPresent(s, weeks)).toEqual([]);
  });

  test("clean when wk1 is genuinely lighter than later weeks", () => {
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      on_ramp_week_1_rpe_max: 6,
      on_ramp_week_1_intensity_max_pct: 70,
    });
    // Main-block-only RPE averaging: wk1=5, wk3 peak=9. Ratio=55.6% — well
    // below the 70% cap. This is the realistic on-ramp shape; an LLM that
    // produces it should not be flagged.
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, rpe: 5 }, // wk1 light
        { trainingDays: 3, rpe: 7 },
        { trainingDays: 4, rpe: 9 }, // peak in wk3
      ]),
    );
    expect(scoreOnRampPresent(s, weeks)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findOutcomePromises — regex layer
// ---------------------------------------------------------------------------

describe("findOutcomePromises — pattern engine", () => {
  test("handles regex metacharacters in patterns", () => {
    expect(findOutcomePromises("lose 4 kg this week", ["lose .* kg"])).toEqual(["lose .* kg"]);
  });

  test("silently skips invalid regex patterns", () => {
    const out = findOutcomePromises("anything", ["bad("]);
    expect(out).toEqual([]); // doesn't throw
  });

  test("returns only distinct hits", () => {
    const out = findOutcomePromises(
      "build muscle and build muscle again",
      ["build muscle"],
    );
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Regression tests for v0.6 scorer bug fixes (2026-06-09)
// ---------------------------------------------------------------------------

describe("regression: bug 1 — rest-day counting with explicit day_of_week", () => {
  // The walker used to compute rest_days = days.length - trainingDays,
  // silently producing 0 rest days for any plan that enumerated only
  // training days (most do — Mon/Wed/Fri with day_of_week 1/3/5).
  test("days array with day_of_week treats unlisted days as implicit rest", () => {
    const plan = {
      plan: {
        phases: [
          {
            weeks: [
              {
                days: [
                  { day_of_week: 1, blocks: [{ type: "main", activities: [{ exercise_ref: "x", prescription: { sets: 3 } }] }] },
                  { day_of_week: 3, blocks: [{ type: "main", activities: [{ exercise_ref: "x", prescription: { sets: 3 } }] }] },
                  { day_of_week: 5, blocks: [{ type: "main", activities: [{ exercise_ref: "x", prescription: { sets: 3 } }] }] },
                ],
              },
            ],
          },
        ],
      },
    };
    const weeks = aggregateWeeks(plan);
    expect(weeks[0]!.trainingDays).toBe(3);
    expect(weeks[0]!.calendarDays).toBe(7);
    // Recovery check: 7 - 3 = 4 rest days, ≥ 2 minimum is fine.
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      recovery_min_rest_days_per_week: 2,
    });
    expect(scoreRecoveryScheduling(s, weeks)).toEqual([]);
  });
});

describe("regression: bug 2 — progression cap default loosened", () => {
  // The old 15% default treated total weekly volume like per-exercise
  // progressive overload. Adding a training day legitimately jumps total
  // weekly volume 30-40% and is normal programming.
  test("default cap is 40% (not 15%), tolerates day-add-driven volume jumps", () => {
    const s = scenario({ block_purpose: "on_ramp", expected_duration_weeks: 4 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 3 }, // 18 sets
        { trainingDays: 4, setsPerSession: 3 }, // 24 sets — +33%, under 40% cap
      ]),
    );
    expect(scoreProgressionRate(s, weeks)).toEqual([]);
  });

  test("still flags genuinely excessive progression (>40%)", () => {
    const s = scenario({ block_purpose: "on_ramp", expected_duration_weeks: 4 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 3, setsPerSession: 2 }, // 12 sets
        { trainingDays: 5, setsPerSession: 4 }, // 40 sets — +233%
      ]),
    );
    expect(scoreProgressionRate(s, weeks)).toHaveLength(1);
  });
});

describe("regression: bug 4 — peaking intensity holds against mid-block peak, not final taper", () => {
  // A 3-week peaking block legitimately ends with a deload/taper.
  // Comparing wk1 RPE to wk3 (taper) RPE flagged correct programming.
  test("3-week peak with mid-week peak + final taper is clean", () => {
    const s = scenario({ block_purpose: "peaking", expected_duration_weeks: 3 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 4, rpe: 7 }, // wk1
        { trainingDays: 3, setsPerSession: 3, rpe: 8 }, // wk2 heaviest
        { trainingDays: 2, setsPerSession: 2, rpe: 5 }, // wk3 taper
      ]),
    );
    expect(scoreBlockPurpose(s, weeks).find((v) => v.item === "peaking_intensity_dropped")).toBeUndefined();
  });

  test("still flags real intensity collapse mid-block", () => {
    const s = scenario({ block_purpose: "peaking", expected_duration_weeks: 3 });
    const weeks = aggregateWeeks(
      makePlan([
        { trainingDays: 4, setsPerSession: 4, rpe: 9 }, // wk1 heavy
        { trainingDays: 3, setsPerSession: 3, rpe: 6 }, // wk2 mid drop — wrong
        { trainingDays: 2, setsPerSession: 2, rpe: 5 }, // wk3 taper
      ]),
    );
    expect(scoreBlockPurpose(s, weeks).some((v) => v.item === "peaking_intensity_dropped")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lane dispatch — end-to-end (gating + asymmetric rule firing)
// ---------------------------------------------------------------------------

describe("scoreShortPlan — lane dispatch", () => {
  test("Lane A: only outcome_promise fires; structural rules are skipped", () => {
    const s = scenario({ block_purpose: "deload", expected_duration_weeks: 1 });
    const v = scoreShortPlan(s, { lane: "A", rawText: "We will build muscle this week." });
    // Should produce outcome_promise but not deload_multi_week / progression / on_ramp_missing
    expect(v.length).toBe(1);
    expect(v[0]!.kind).toBe("outcome_promise");
  });

  test("Lane B: all five rule families wired", () => {
    const s = scenario({
      block_purpose: "on_ramp",
      expected_duration_weeks: 4,
      on_ramp_week_1_rpe_max: 6,
      recovery_min_rest_days_per_week: 2,
      progression_max_pct_per_week: 10,
    });
    const plan = makePlan(
      [
        { trainingDays: 6, setsPerSession: 2, rpe: 9 }, // wk1 RPE high + only 1 rest
        { trainingDays: 4, setsPerSession: 5, rpe: 8 }, // huge jump in sets
      ],
      { description: "Build muscle this month — guaranteed!" },
    );
    const v = scoreShortPlan(s, { lane: "B", wplJson: plan });
    const kinds = new Set(v.map((x) => x.kind));
    // At minimum: outcome_promise, recovery_insufficient, progression_too_fast,
    // on_ramp_missing, block_purpose_mismatch (non-ascending: wk2 sets 40 > wk1 sets 24,
    // so ascending OK — block_purpose may not fire here).
    expect(kinds.has("outcome_promise")).toBe(true);
    expect(kinds.has("recovery_insufficient")).toBe(true);
    expect(kinds.has("progression_too_fast")).toBe(true);
    expect(kinds.has("on_ramp_missing")).toBe(true);
  });

  test("Lane B without wplJson is a no-op", () => {
    const s = scenario({ block_purpose: "deload", expected_duration_weeks: 1 });
    expect(scoreShortPlan(s, { lane: "B", wplJson: null })).toEqual([]);
  });
});
