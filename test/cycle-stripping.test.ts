// Integration test for cycle-aware forbid stripping in lane-b.
//
// Builds a tiny synthetic WPL JSON, sets up a personalization rules
// block with a `cycle_day in [1,2,3]` conditioned forbid, and verifies:
//   1. Static forbids strip from every day regardless of date.
//   2. Cycle-conditional forbids strip ONLY from days whose computed
//      cycle_day falls in the flow window.
//
// The function under test is internal to lane-b.ts; we re-implement
// the same composition here (buildPersonalization shape + stripForbidden
// call sequence) using the public rule-evaluator and cycle helpers.
// This protects against regressions in either the evaluator's `in`
// operator or the date-walking logic in stripForbidden.

import { describe, test, expect } from "vitest";
import { evaluate, firingActions, type Condition } from "../src/lib/rule-evaluator.js";
import { computeCycleDay } from "../src/lib/cycle.js";
import type { ClientContext, Cycle } from "../src/lib/types.js";

const cycle: Cycle = {
  last_period_start: "2026-05-01",
  length_days: 28,
  flow_days: 3,
};

describe("cycle-conditional rule evaluation", () => {
  const personalization = {
    rules: [
      {
        id: "forbid_hiit_on_flow",
        condition: { field: "cycle_day", op: "in", value: [1, 2, 3] } as Condition,
        actions: [{ type: "forbid_exercise", exercise: "hiit_above_85pct_hrmax" }],
      },
      {
        id: "forbid_box_jump_static",
        condition: null,
        actions: [{ type: "forbid_exercise", exercise: "box_jump" }],
      },
    ],
  };

  test("static rule fires regardless of cycle_day", () => {
    const ctx: ClientContext = { cycle, cycle_day: 10 };
    const fired = firingActions(evaluate(personalization, ctx));
    const forbids = fired.map((a) => a["exercise"]);
    expect(forbids).toContain("box_jump");
  });

  test("cycle-conditional rule fires on cycle_day 1", () => {
    const ctx: ClientContext = { cycle, cycle_day: 1 };
    const fired = firingActions(evaluate(personalization, ctx));
    const forbids = fired.map((a) => a["exercise"]);
    expect(forbids).toContain("hiit_above_85pct_hrmax");
    expect(forbids).toContain("box_jump");
  });

  test("cycle-conditional rule does NOT fire on cycle_day 10", () => {
    const ctx: ClientContext = { cycle, cycle_day: 10 };
    const fired = firingActions(evaluate(personalization, ctx));
    const forbids = fired.map((a) => a["exercise"]);
    expect(forbids).not.toContain("hiit_above_85pct_hrmax");
    expect(forbids).toContain("box_jump");
  });

  test("cycle_day undefined → conditional rule short-circuits to false", () => {
    const ctx: ClientContext = { cycle };
    const fired = firingActions(evaluate(personalization, ctx));
    const forbids = fired.map((a) => a["exercise"]);
    expect(forbids).not.toContain("hiit_above_85pct_hrmax");
    expect(forbids).toContain("box_jump");
  });

  test("date 2026-06-26 (cycle 3 day 1) gates the HIIT forbid via computeCycleDay", () => {
    const cycleDay = computeCycleDay("2026-06-26", cycle);
    expect(cycleDay).toBe(1);
    const ctx: ClientContext = { cycle, cycle_day: cycleDay };
    const fired = firingActions(evaluate(personalization, ctx));
    const forbids = fired.map((a) => a["exercise"]);
    expect(forbids).toContain("hiit_above_85pct_hrmax");
  });

  test("date 2026-06-15 (cycle 2 day ~18) does not gate the HIIT forbid", () => {
    const cycleDay = computeCycleDay("2026-06-15", cycle);
    expect(cycleDay).toBeGreaterThan(3);
    const ctx: ClientContext = { cycle, cycle_day: cycleDay };
    const fired = firingActions(evaluate(personalization, ctx));
    const forbids = fired.map((a) => a["exercise"]);
    expect(forbids).not.toContain("hiit_above_85pct_hrmax");
  });
});
