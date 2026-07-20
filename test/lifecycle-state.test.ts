import { describe, it, expect } from "vitest";
import {
  isLifecycle,
  mergeContextAtTurn,
  activeRulesAtTurn,
  validateLifecycleScenario,
} from "../src/lib/lifecycle.js";
import type { Scenario, ClientContext } from "../src/lib/types.js";

// Minimal scenario factory — only fields the helpers touch.
function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "test_lifecycle",
    persona: "p",
    presenting: {},
    blacklist: {},
    single_turn_prompt: "x",
    multi_turn: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"],
    drift_check_at_turn: 6,
    safety_rationale: "r",
    ...overrides,
  } as Scenario;
}

const BASE: ClientContext = {
  injuries: [],
  equipment: ["gym_full"],
  experience: "intermediate",
  goals: ["strength"],
  sex: "female",
  cycle: { pattern: "irregular" },
};

describe("isLifecycle", () => {
  it("false without turn_states", () => {
    expect(isLifecycle(makeScenario())).toBe(false);
  });
  it("true with turn_states", () => {
    expect(
      isLifecycle(
        makeScenario({
          turn_states: [{ turn: 4, context: { injuries: ["hamstring_strain_grade1"] } }],
          lifecycle_criteria: [{ id: "c1", from_turn: 4, must_not_contain: ["deadlift"] }],
        }),
      ),
    ).toBe(true);
  });
});

describe("mergeContextAtTurn", () => {
  const s = makeScenario({
    turn_states: [
      { turn: 4, context: { injuries: ["hamstring_strain_grade1"] } },
      { turn: 6, context: { injuries: [], cycle: { pattern: "regular", last_period_start: "2026-05-03", length_days: 28, flow_days: 3 } } },
    ],
    lifecycle_criteria: [{ id: "c1", from_turn: 1 }],
  });

  it("turn before any state returns base unchanged", () => {
    expect(mergeContextAtTurn(BASE, s, 1)).toEqual(BASE);
  });
  it("applies overlay at its turn", () => {
    expect(mergeContextAtTurn(BASE, s, 4).injuries).toEqual(["hamstring_strain_grade1"]);
  });
  it("later overlay wins; cycle replaced wholesale", () => {
    const at6 = mergeContextAtTurn(BASE, s, 6);
    expect(at6.injuries).toEqual([]);
    expect(at6.cycle).toEqual({ pattern: "regular", last_period_start: "2026-05-03", length_days: 28, flow_days: 3 });
  });
  it("untouched keys survive every merge", () => {
    expect(mergeContextAtTurn(BASE, s, 8).equipment).toEqual(["gym_full"]);
  });
  it("does not mutate the base", () => {
    const before = JSON.parse(JSON.stringify(BASE));
    mergeContextAtTurn(BASE, s, 8);
    expect(BASE).toEqual(before);
  });
});

describe("activeRulesAtTurn", () => {
  const baseRules = [
    { id: "r_base", actions: [{ type: "forbid_exercise", exercise: "box_jump" }] },
  ];
  const injuredRules = [
    { id: "r_injured", actions: [{ type: "forbid_exercise", exercise: "deadlift" }] },
  ];
  const s = makeScenario({
    rules: baseRules,
    turn_states: [
      { turn: 4, rules: injuredRules },
      { turn: 6, context: { fatigue: "high" } }, // no rules key → previous set stays
      { turn: 8, rules: baseRules },
    ],
    lifecycle_criteria: [{ id: "c1", from_turn: 1 }],
  });

  it("base rules before first override", () => {
    expect(activeRulesAtTurn(s, 3)).toEqual(baseRules);
  });
  it("replacement at its turn", () => {
    expect(activeRulesAtTurn(s, 4)).toEqual(injuredRules);
  });
  it("retention when a state has no rules key", () => {
    expect(activeRulesAtTurn(s, 7)).toEqual(injuredRules);
  });
  it("restoration by a later replacement", () => {
    expect(activeRulesAtTurn(s, 8)).toEqual(baseRules);
  });
  it("non-lifecycle scenario returns scenario rules", () => {
    expect(activeRulesAtTurn(makeScenario({ rules: baseRules }), 5)).toEqual(baseRules);
  });
});

describe("validateLifecycleScenario", () => {
  it("accepts a valid scenario", () => {
    const s = makeScenario({
      turn_states: [{ turn: 4, context: {} }],
      lifecycle_criteria: [{ id: "c1", from_turn: 4, to_turn: 8, weeks: { from: 3, to: 7 }, must_not_contain: ["deadlift"] }],
    });
    expect(() => validateLifecycleScenario(s)).not.toThrow();
  });
  it("no-op for non-lifecycle scenarios", () => {
    expect(() => validateLifecycleScenario(makeScenario())).not.toThrow();
  });
  it("rejects turn out of range", () => {
    const s = makeScenario({
      turn_states: [{ turn: 9 }],
      lifecycle_criteria: [{ id: "c1", from_turn: 1 }],
    });
    expect(() => validateLifecycleScenario(s)).toThrow(/turn 9/);
  });
  it("rejects non-ascending turn_states", () => {
    const s = makeScenario({
      turn_states: [{ turn: 6 }, { turn: 4 }],
      lifecycle_criteria: [{ id: "c1", from_turn: 1 }],
    });
    expect(() => validateLifecycleScenario(s)).toThrow(/ascending/);
  });
  it("rejects criteria without turn_states and vice versa", () => {
    expect(() =>
      validateLifecycleScenario(makeScenario({ lifecycle_criteria: [{ id: "c1", from_turn: 1 }] })),
    ).toThrow(/turn_states/);
    expect(() =>
      validateLifecycleScenario(makeScenario({ turn_states: [{ turn: 2 }] })),
    ).toThrow(/lifecycle_criteria/);
  });
  it("rejects from_turn > to_turn and bad week range", () => {
    const s = makeScenario({
      turn_states: [{ turn: 2 }],
      lifecycle_criteria: [{ id: "c1", from_turn: 6, to_turn: 4 }],
    });
    expect(() => validateLifecycleScenario(s)).toThrow(/from_turn/);
    const s2 = makeScenario({
      turn_states: [{ turn: 2 }],
      lifecycle_criteria: [{ id: "c1", from_turn: 1, weeks: { from: 7, to: 3 } }],
    });
    expect(() => validateLifecycleScenario(s2)).toThrow(/weeks/);
  });
  it("rejects slugs outside the vocab when a vocab is given", () => {
    const s = makeScenario({
      turn_states: [{ turn: 2 }],
      lifecycle_criteria: [{ id: "c1", from_turn: 1, must_not_contain: ["not_a_real_exercise_xyz"] }],
    });
    expect(() => validateLifecycleScenario(s, new Set(["deadlift"]))).toThrow(/not_a_real_exercise_xyz/);
  });
});
