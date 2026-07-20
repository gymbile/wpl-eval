import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ALL_EXERCISES } from "@gymbile/wpl-ai";
import { validateLifecycleScenario, isLifecycle } from "../src/lib/lifecycle.js";
import type { Scenario } from "../src/lib/types.js";

const EXPECTED_IDS = [
  "lifecycle_injury_return",
  "lifecycle_postpartum_gate",
  "lifecycle_travel_deload",
  "lifecycle_cardiac_phases",
  "lifecycle_cycle_transition",
];

function loadCorpus(): Scenario[] {
  const raw = readFileSync(resolve(process.cwd(), "scenarios/scenarios.yaml"), "utf8");
  return (parseYaml(raw) as { scenarios: Scenario[] }).scenarios;
}

describe("lifecycle corpus", () => {
  const scenarios = loadCorpus();
  const vocab = new Set(ALL_EXERCISES as readonly string[]);

  it("contains the five L1-L5 scenarios", () => {
    const ids = scenarios.map((s) => s.id);
    for (const id of EXPECTED_IDS) expect(ids).toContain(id);
  });

  it("every lifecycle scenario validates (turns, ranges, canonical slugs)", () => {
    for (const s of scenarios.filter(isLifecycle)) {
      expect(() => validateLifecycleScenario(s, vocab)).not.toThrow();
    }
  });

  it("every lifecycle scenario is 8-turn multi-turn with rules and rationale", () => {
    for (const id of EXPECTED_IDS) {
      const s = scenarios.find((x) => x.id === id)!;
      expect(s.multi_turn).toHaveLength(8);
      expect((s.lifecycle_criteria ?? []).length).toBeGreaterThan(0);
      expect(s.safety_rationale.length).toBeGreaterThan(50);
    }
  });

  it("pre-existing scenarios are untouched by lifecycle fields", () => {
    for (const s of scenarios.filter((x) => !EXPECTED_IDS.includes(x.id))) {
      expect(s.turn_states).toBeUndefined();
      expect(s.lifecycle_criteria).toBeUndefined();
    }
  });

  // The fuzzy matcher's core-token subset rule means a must_not slug like
  // "deadlift" also collides with "romanian_deadlift". A criterion pair
  // where a must_eventually slug collides with an overlapping criterion's
  // must_not slug can never pass — reject it at lint time.
  it("no must_eventually slug collides with an overlapping must_not slug", async () => {
    const { collides } = await import("../src/scoring/blacklist.js");
    for (const s of scenarios.filter(isLifecycle)) {
      const cs = s.lifecycle_criteria!;
      for (const a of cs) {
        for (const b of cs) {
          const aTo = a.to_turn ?? s.multi_turn.length;
          const bTo = b.to_turn ?? s.multi_turn.length;
          const turnsOverlap = a.from_turn <= bTo && b.from_turn <= aTo;
          if (!turnsOverlap) continue;
          for (const want of a.must_eventually_contain ?? []) {
            for (const forbid of b.must_not_contain ?? []) {
              expect(
                collides(want, forbid),
                `${s.id}: ${a.id} wants "${want}" but ${b.id} forbids "${forbid}" (fuzzy collision)`,
              ).toBe(false);
            }
          }
        }
      }
    }
  });
});
