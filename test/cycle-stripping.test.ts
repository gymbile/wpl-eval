// Integration test for cycle-aware forbid stripping in lane-b.
//
// Retargeted to call the real enforce() from @gymbile/wpl-validator (Task 19),
// matching exactly what lane-b.ts now passes to the shipped engine.
//
// The composition under test:
//   enforce(planJson, ctx, rules, { planStartDate, perDayExtraForbids })
//
// Three enforcement paths are exercised:
//   1. Static forbids (condition: null) — strip from every day.
//   2. Cycle-conditional forbids (cycle_day in [1..N]) — strip only from
//      days whose computed cycle_day falls in the flow window.
//   3. Flare-window extra forbids via perDayExtraForbids — projection-
//      independent date-range membership, passed as an extra-forbid callback.
//
// NOTE: The shipped enforce() uses the collides() matcher internally, which
// requires that the forbid pattern name is NOT led by a qualifier token
// (heavy/deep/light/…). Use canonical non-qualifier exercise names like
// `box_jump` and `plank` instead of `hiit_above_85pct_hrmax`.

import { describe, test, expect } from "vitest";
import { enforce } from "@gymbile/wpl-validator";
import { computeCycleDay } from "../src/lib/cycle.js";
import type { ClientContext, Cycle } from "../src/lib/types.js";

const cycle: Cycle = {
  last_period_start: "2026-05-01",
  length_days: 28,
  flow_days: 3,
};

// Minimal synthetic WPL JSON with two exercises per day.
// plan_start_date 2026-06-23 (Monday) = cycle day 24 (non-flow)
// plan_start_date 2026-06-26 (Thursday) = cycle day 1 of cycle 3 (flow!)
function buildPlan(exercises: string[]): Record<string, unknown> {
  return {
    plan: {
      phases: [
        {
          weeks: [
            {
              order: 1,
              days: [
                {
                  day_of_week: "monday",
                  blocks: [
                    {
                      type: "main",
                      activities: exercises.map((ex) => ({
                        exercise_ref: ex,
                        name: ex,
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function activitiesInPlan(plan: Record<string, unknown>): string[] {
  const p = plan["plan"] as Record<string, unknown>;
  const phases = p["phases"] as Record<string, unknown>[];
  const weeks = (phases[0]!["weeks"] as Record<string, unknown>[]);
  const days = (weeks[0]!["days"] as Record<string, unknown>[]);
  const blocks = (days[0]!["blocks"] as Record<string, unknown>[]);
  const activities = (blocks[0]!["activities"] as Record<string, unknown>[]);
  return activities.map((a) => a["exercise_ref"] as string);
}

describe("enforce() — static forbids (condition: null)", () => {
  const ctx: ClientContext = { cycle, injuries: [] };
  const rules = [
    {
      id: "forbid_box_jump_static",
      condition: null as null,
      actions: [{ type: "forbid_exercise", exercise: "box_jump" }],
    },
  ];

  test("strips the forbidden exercise from every day regardless of cycle_day", () => {
    const plan = buildPlan(["box_jump", "plank"]);
    const { plan: enforced, diagnostics } = enforce(plan, ctx, rules);
    expect(diagnostics).toHaveLength(0);
    const remaining = activitiesInPlan(enforced);
    expect(remaining).not.toContain("box_jump");
    expect(remaining).toContain("plank");
  });

  test("does not strip exercises not in the forbid set", () => {
    const plan = buildPlan(["plank", "push_up"]);
    const { plan: enforced, diagnostics } = enforce(plan, ctx, rules);
    expect(diagnostics).toHaveLength(0);
    const remaining = activitiesInPlan(enforced);
    expect(remaining).toContain("plank");
    expect(remaining).toContain("push_up");
  });
});

describe("enforce() — cycle-conditional forbids (cycle_day in [1,2,3])", () => {
  // flow_days: 3, so cycle days 1..3 are the flow window.
  const ctx: ClientContext = { cycle, injuries: [] };
  const rules = [
    {
      id: "forbid_plank_on_flow",
      condition: { field: "cycle_day", op: "in", value: [1, 2, 3] } as const,
      actions: [{ type: "forbid_exercise", exercise: "plank" }],
    },
    {
      id: "forbid_box_jump_static",
      condition: null as null,
      actions: [{ type: "forbid_exercise", exercise: "box_jump" }],
    },
  ];

  test("cycle day 1 (flow): strips conditional forbid AND static forbid", () => {
    // 2026-06-26 = cycle 3, day 1 (flow day)
    const plan = buildPlan(["plank", "box_jump", "push_up"]);
    const { plan: enforced, diagnostics } = enforce(plan, ctx, rules, {
      planStartDate: "2026-06-26",
    });
    expect(diagnostics).toHaveLength(0);
    const remaining = activitiesInPlan(enforced);
    expect(remaining).not.toContain("plank");     // conditional forbid fired
    expect(remaining).not.toContain("box_jump");  // static forbid fired
    expect(remaining).toContain("push_up");       // neither forbid matched
  });

  test("cycle day 24 (non-flow): static forbid fires, conditional does NOT", () => {
    // 2026-06-23 = cycle 2, day 24 (not flow)
    const cycleDay = computeCycleDay("2026-06-23", cycle);
    expect(cycleDay).toBeGreaterThan(3);

    const plan = buildPlan(["plank", "box_jump", "push_up"]);
    const { plan: enforced, diagnostics } = enforce(plan, ctx, rules, {
      planStartDate: "2026-06-23",
    });
    expect(diagnostics).toHaveLength(0);
    const remaining = activitiesInPlan(enforced);
    expect(remaining).toContain("plank");         // conditional forbid did NOT fire
    expect(remaining).not.toContain("box_jump");  // static forbid fired
    expect(remaining).toContain("push_up");
  });

  test("date 2026-06-26 is confirmed as cycle day 1 via computeCycleDay", () => {
    const cycleDay = computeCycleDay("2026-06-26", cycle);
    expect(cycleDay).toBe(1);
  });

  test("date 2026-06-15 is confirmed to be beyond the flow window", () => {
    const cycleDay = computeCycleDay("2026-06-15", cycle);
    expect(cycleDay).toBeGreaterThan(3);
  });
});

describe("enforce() — flare-window perDayExtraForbids", () => {
  const flareStart = "2026-06-20";
  const flareEnd = "2026-06-27";
  const ctx: ClientContext = {
    cycle: {
      ...cycle,
      pattern: "irregular", // irregular = no cycle_day projection
      flare_windows: [{ start: flareStart, end: flareEnd }],
    },
    injuries: [],
  };
  const flareForbids: ReadonlySet<string> = new Set(["push_up"]);
  const perDayExtraForbids = (date: string): ReadonlySet<string> => {
    if (date >= flareStart && date <= flareEnd) return flareForbids;
    return new Set();
  };

  test("strips flare-window exercise when plan day falls inside the window", () => {
    // 2026-06-23 is a Monday inside the flare window [2026-06-20, 2026-06-27]
    const plan = buildPlan(["push_up", "plank"]);
    const { plan: enforced, diagnostics } = enforce(plan, ctx, [], {
      planStartDate: "2026-06-23",
      perDayExtraForbids,
    });
    expect(diagnostics).toHaveLength(0);
    const remaining = activitiesInPlan(enforced);
    expect(remaining).not.toContain("push_up");  // inside flare window
    expect(remaining).toContain("plank");
  });

  test("does NOT strip flare-window exercise when plan day is outside the window", () => {
    // 2026-06-29 is a Monday outside the flare window [2026-06-20, 2026-06-27]
    const plan = buildPlan(["push_up", "plank"]);
    const { plan: enforced, diagnostics } = enforce(plan, ctx, [], {
      planStartDate: "2026-06-29",
      perDayExtraForbids,
    });
    expect(diagnostics).toHaveLength(0);
    const remaining = activitiesInPlan(enforced);
    expect(remaining).toContain("push_up");  // outside flare window
    expect(remaining).toContain("plank");
  });
});
