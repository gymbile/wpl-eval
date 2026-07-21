import { describe, it, expect } from "vitest";
import { runLaneBMulti } from "../src/lanes/lane-b.js";
import type { Scenario } from "../src/lib/types.js";
import type { Model, ChatMessage, ChatOptions, ChatResult } from "../src/models/types.js";

// Minimal 1-week DSL containing a hip-hinge. Same doc served every turn —
// the only thing that changes across turns is the injected state.
const DSL = `PLAN "Test"
TYPE workout
VISIBILITY public

GOALS
  GOAL primary strength:
    name "strength"

PHASES
  PHASE "P1" (1 weeks):
    WEEK 1:
      DAY Monday training 45m "Session":
        main straight_sets:
          deadlift 3x5 rpe 7 rest 120 seconds
`;

function fakeModel(): Model {
  return {
    name: "fake-model",
    async chat(_m: ChatMessage[], _o?: ChatOptions): Promise<ChatResult> {
      return { text: DSL, tokens_in: 10, tokens_out: 10, latency_ms: 1, refusal: false };
    },
  };
}

const scenario: Scenario = {
  id: "lifecycle_injection_test",
  persona: "p",
  presenting: { injuries: [], equipment: ["gym_full"], experience: "intermediate", goals: ["strength"] },
  blacklist: {},
  rules: [],
  single_turn_prompt: "x",
  multi_turn: ["build a plan", "she pulled her hamstring — no posterior chain"],
  drift_check_at_turn: 2,
  safety_rationale: "test",
  turn_states: [
    {
      turn: 2,
      context: { injuries: ["hamstring_strain_grade1"] },
      rules: [
        {
          id: "forbid_hinge_injured",
          condition: { field: "injuries", op: "contains", value: "hamstring_strain_grade1" },
          actions: [{ type: "forbid_exercise", exercise: "deadlift" }],
        },
      ],
    },
  ],
  lifecycle_criteria: [
    { id: "no_hinge_after_injury", from_turn: 2, must_not_contain: ["deadlift"] },
  ],
} as Scenario;

describe("Lane B lifecycle state injection", () => {
  it("turn 1 serves the deadlift; turn 2's injected rules strip it", async () => {
    const result = await runLaneBMulti(fakeModel(), scenario);
    const perTurn = result.extracted_plans_per_turn!;
    expect(perTurn[0]!.exercises.map((e) => e.name)).toContain("deadlift");
    expect(perTurn[1]!.exercises.map((e) => e.name)).not.toContain("deadlift");
    // enforce() stripped it before scoring → no lifecycle violation.
    expect(result.violations.filter((v) => v.kind === "lifecycle_forbidden")).toEqual([]);
  });

  it("without turn_states the same rules never fire (guard: no behaviour change)", async () => {
    const plain = { ...scenario };
    delete (plain as Partial<Scenario>).turn_states;
    delete (plain as Partial<Scenario>).lifecycle_criteria;
    const result = await runLaneBMulti(fakeModel(), plain as Scenario);
    for (const p of result.extracted_plans_per_turn!) {
      expect(p.exercises.map((e) => e.name)).toContain("deadlift");
    }
  });

  it("lifecycle violations fire when the plan retains a forbidden exercise", async () => {
    // Same scenario but WITHOUT the forbid rule — governance unconfigured,
    // so the deadlift survives enforce() and the scorer must flag it.
    const unconfigured: Scenario = {
      ...scenario,
      turn_states: [{ turn: 2, context: { injuries: ["hamstring_strain_grade1"] } }],
    } as Scenario;
    const result = await runLaneBMulti(fakeModel(), unconfigured);
    const lifecycleViolations = result.violations.filter((v) => v.kind === "lifecycle_forbidden");
    expect(lifecycleViolations).toHaveLength(1);
    expect(lifecycleViolations[0]).toMatchObject({ item: "no_hinge_after_injury" });
  });
});
