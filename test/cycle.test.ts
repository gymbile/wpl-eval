import { describe, test, expect } from "vitest";
import {
  computeCycleDay,
  isOnFlowDay,
  projectFlowWindows,
  dayDateForPlanPosition,
  dayOfWeekOffset,
} from "../src/lib/cycle.js";
import type { Cycle } from "../src/lib/types.js";

const cycle: Cycle = {
  last_period_start: "2026-05-01",
  length_days: 28,
  flow_days: 3,
};

describe("cycle helpers", () => {
  describe("computeCycleDay", () => {
    test("anchor date returns cycle_day 1", () => {
      expect(computeCycleDay("2026-05-01", cycle)).toBe(1);
    });

    test("day after anchor returns 2", () => {
      expect(computeCycleDay("2026-05-02", cycle)).toBe(2);
    });

    test("day 28 wraps to day 28 not day 0", () => {
      expect(computeCycleDay("2026-05-28", cycle)).toBe(28);
    });

    test("day 29 starts new cycle at day 1", () => {
      expect(computeCycleDay("2026-05-29", cycle)).toBe(1);
    });

    test("multi-cycle projection: 2026-06-26 is cycle 3 day 1", () => {
      // Anchor + 56 days = 2026-06-26
      expect(computeCycleDay("2026-06-26", cycle)).toBe(1);
    });

    test("dates before anchor still get a sensible cycle_day", () => {
      // 2026-04-30 is one day before the anchor, so it's cycle_day 28
      // (end of the preceding cycle).
      expect(computeCycleDay("2026-04-30", cycle)).toBe(28);
    });
  });

  describe("isOnFlowDay", () => {
    test("anchor date is in flow window", () => {
      expect(isOnFlowDay("2026-05-01", cycle)).toBe(true);
      expect(isOnFlowDay("2026-05-02", cycle)).toBe(true);
      expect(isOnFlowDay("2026-05-03", cycle)).toBe(true);
    });

    test("day 4 is past flow window", () => {
      expect(isOnFlowDay("2026-05-04", cycle)).toBe(false);
    });

    test("next cycle's flow window also matches", () => {
      // Anchor + 28 days = 2026-05-29; flow days 2026-05-29..31
      expect(isOnFlowDay("2026-05-29", cycle)).toBe(true);
      expect(isOnFlowDay("2026-05-31", cycle)).toBe(true);
      expect(isOnFlowDay("2026-06-01", cycle)).toBe(false);
    });
  });

  describe("projectFlowWindows", () => {
    test("12-week plan starting 2026-06-01 contains 3 flow windows", () => {
      const windows = projectFlowWindows("2026-06-01", "2026-08-23", cycle);
      // Cycle 3 flow: 2026-06-26..28
      // Cycle 4 flow: 2026-07-24..26
      // Cycle 5 flow: 2026-08-21..23
      expect(windows).toEqual([
        "2026-06-26",
        "2026-06-27",
        "2026-06-28",
        "2026-07-24",
        "2026-07-25",
        "2026-07-26",
        "2026-08-21",
        "2026-08-22",
        "2026-08-23",
      ]);
    });

    test("empty range returns empty", () => {
      const windows = projectFlowWindows("2026-06-10", "2026-06-09", cycle);
      expect(windows).toEqual([]);
    });
  });

  describe("dayDateForPlanPosition", () => {
    test("phase 1 week 1 Monday is plan start", () => {
      expect(dayDateForPlanPosition("2026-06-01", 0, 1, 0)).toBe("2026-06-01");
    });

    test("phase 1 week 1 Friday is start + 4 days", () => {
      expect(dayDateForPlanPosition("2026-06-01", 0, 1, 4)).toBe("2026-06-05");
    });

    test("phase 2 week 1 Monday is start + 4 weeks", () => {
      // weeksBeforePhase=4 (phase 1 was 4 weeks), weekInPhase=1, dayOffset=0
      expect(dayDateForPlanPosition("2026-06-01", 4, 1, 0)).toBe("2026-06-29");
    });

    test("week 12 final day of programme", () => {
      // 11 weeks + 6 days = 11*7+6 = 83 days
      // 2026-06-01 + 83 = 2026-08-23
      expect(dayDateForPlanPosition("2026-06-01", 8, 4, 6)).toBe("2026-08-23");
    });
  });

  describe("cycle patterns", () => {
    test("suppressed cycle: isProjectable=false and isOnFlowDay always false", async () => {
      const { isProjectable } = await import("../src/lib/cycle.js");
      const suppressed: Cycle = { pattern: "suppressed", flow_days: 3 };
      expect(isProjectable(suppressed)).toBe(false);
      expect(isOnFlowDay("2026-05-01", suppressed)).toBe(false);
      expect(isOnFlowDay("2026-06-26", suppressed)).toBe(false);
      expect(computeCycleDay("2026-05-01", suppressed)).toBe(null);
    });

    test("irregular cycle: isProjectable=false, flow_days projection blocked", async () => {
      const { isProjectable } = await import("../src/lib/cycle.js");
      const irregular: Cycle = { pattern: "irregular" };
      expect(isProjectable(irregular)).toBe(false);
      expect(isOnFlowDay("2026-05-01", irregular)).toBe(false);
      expect(computeCycleDay("2026-05-01", irregular)).toBe(null);
    });

    test("irregular cycle WITH flare_windows: isOnFlowDay true inside flares only", async () => {
      const withFlares: Cycle = {
        pattern: "irregular",
        flare_windows: [
          { start: "2026-07-10", end: "2026-07-13" },
          { start: "2026-08-04", end: "2026-08-07" },
        ],
      };
      expect(isOnFlowDay("2026-06-15", withFlares)).toBe(false);
      expect(isOnFlowDay("2026-07-10", withFlares)).toBe(true);
      expect(isOnFlowDay("2026-07-13", withFlares)).toBe(true);
      expect(isOnFlowDay("2026-07-14", withFlares)).toBe(false);
      expect(isOnFlowDay("2026-08-04", withFlares)).toBe(true);
      expect(isOnFlowDay("2026-08-08", withFlares)).toBe(false);
    });

    test("regular cycle WITH flare_windows: flow AND flare windows both trigger", async () => {
      const regular: Cycle = {
        pattern: "regular",
        last_period_start: "2026-05-04",
        length_days: 27,
        flow_days: 4,
        flare_windows: [{ start: "2026-07-10", end: "2026-07-13" }],
      };
      // Cycle 4 of length 27 from 2026-05-04 → next flow window is
      // 2026-05-31..06-03; then 2026-06-27..06-30; then 2026-07-24..07-27;
      // 2026-07-10 is mid-cycle (cycle_day ~10) — not a flow day, but is
      // in the flare window.
      expect(isOnFlowDay("2026-07-10", regular)).toBe(true);
      // 2026-07-25 is in cycle's natural flow window.
      expect(isOnFlowDay("2026-07-25", regular)).toBe(true);
      // 2026-07-14 is past the flare window and not in a flow window.
      expect(isOnFlowDay("2026-07-14", regular)).toBe(false);
    });

    test("regular pattern is the default when omitted", async () => {
      const cycle: Cycle = {
        last_period_start: "2026-05-01",
        length_days: 28,
        flow_days: 3,
      };
      expect(isOnFlowDay("2026-05-01", cycle)).toBe(true);
    });
  });

  describe("dayOfWeekOffset", () => {
    test("string day names map to 0..6", () => {
      expect(dayOfWeekOffset("Monday")).toBe(0);
      expect(dayOfWeekOffset("tuesday")).toBe(1);
      expect(dayOfWeekOffset("SUNDAY")).toBe(6);
    });

    test("numeric 1..7 maps to 0..6", () => {
      expect(dayOfWeekOffset(1)).toBe(0);
      expect(dayOfWeekOffset(7)).toBe(6);
    });

    test("unknown tokens return null (REST, FLEX, etc.)", () => {
      expect(dayOfWeekOffset("REST")).toBe(null);
      expect(dayOfWeekOffset("flex")).toBe(null);
      expect(dayOfWeekOffset(0)).toBe(null);
      expect(dayOfWeekOffset(undefined)).toBe(null);
    });
  });
});
