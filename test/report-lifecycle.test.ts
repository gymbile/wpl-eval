import { describe, it, expect } from "vitest";
import { buildAdaptationMatrix } from "../src/report.js";
import type { RunResult, Scenario } from "../src/lib/types.js";

const scenario = {
  id: "lifecycle_injury_return",
  persona: "p",
  presenting: {},
  blacklist: {},
  single_turn_prompt: "x",
  multi_turn: ["a", "b"],
  drift_check_at_turn: 2,
  safety_rationale: "r",
  turn_states: [{ turn: 2 }],
  lifecycle_criteria: [
    { id: "injured_no_hinge", from_turn: 2 },
    { id: "cleared_hinge_returns", from_turn: 2 },
  ],
} as Scenario;

function res(overrides: Partial<RunResult>): RunResult {
  return {
    model: "gpt-5-mini",
    scenario_id: "lifecycle_injury_return",
    lane: "B",
    phase: "multi",
    safety_violations: 0,
    clean_plan: true,
    first_violation_week: null,
    drift_turn: null,
    refusal: false,
    latency_p50_ms: 0,
    latency_p95_ms: 0,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    wpl_valid: true,
    wpl_schema_valid: true,
    compile_errors: 0,
    validator_errors: 0,
    violations: [],
    timestamp: "2026-07-20T00:00:00Z",
    ...overrides,
  } as RunResult;
}

describe("buildAdaptationMatrix", () => {
  it("empty when no lifecycle results", () => {
    expect(buildAdaptationMatrix([res({ scenario_id: "torn_meniscus" })], [scenario])).toEqual([]);
  });

  it("one table per lifecycle scenario; cells keyed by criterion id", () => {
    const results = [
      res({ lane: "A", violations: [{ kind: "lifecycle_forbidden", item: "injured_no_hinge", detail: "deadlift served at turn 2" }] }),
      res({ lane: "B" }),
    ];
    const lines = buildAdaptationMatrix(results, [scenario]).join("\n");
    expect(lines).toContain("lifecycle_injury_return");
    expect(lines).toContain("injured_no_hinge");
    expect(lines).toContain("cleared_hinge_returns");
    // Lane A fails the first criterion, Lane B passes both.
    const rowA = lines.split("\n").find((l) => l.startsWith("| injured_no_hinge"))!;
    expect(rowA).toContain("✗"); // gpt-5-mini/A
    expect(rowA).toContain("✓"); // gpt-5-mini/B
  });

  it("a result with no served plan (never compiled) renders — not ✓", () => {
    const results = [res({ lane: "B", wpl_valid: false, clean_plan: false })];
    const lines = buildAdaptationMatrix(results, [scenario]).join("\n");
    const rowA = lines.split("\n").find((l) => l.startsWith("| injured_no_hinge"))!;
    expect(rowA).toContain("—");
  });
});
