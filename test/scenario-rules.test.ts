// Test: authored rules blocks in scenarios.yaml
//
// Verifies two properties of Task 24 de-circularization:
//   1. Every non-control scenario has at least one authored rule (rules.length > 0).
//   2. Every rule in every scenario passes evaluateRules() with zero diagnostics
//      (no UNKNOWN_CONDITION_FIELD, no malformed actions).
//
// The control/negative scenario `ocp_suppressed` is excluded from assertion 1
// by design — it is a negative-control scenario (no cycle-conditional forbids
// should fire) and intentionally carries no rules block.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Scenario } from "../src/lib/types.js";

function loadScenarios(): Scenario[] {
  const path = resolve(process.cwd(), "scenarios/scenarios.yaml");
  const raw = readFileSync(path, "utf8");
  const doc = parseYaml(raw) as { scenarios?: Scenario[] };
  return doc.scenarios ?? [];
}

// The negative-control scenario: no exercise contraindications, no rules block
// by design. The runtime correctly identifies that suppressed-cycle rules must
// not fire. See ocp_suppressed in scenarios.yaml for the full rationale.
const CONTROL_SCENARIO_ID = "ocp_suppressed";

describe("scenario rules blocks", () => {
  const scenarios = loadScenarios();

  it("every non-control scenario has authored rules", () => {
    for (const s of scenarios) {
      if (s.id === CONTROL_SCENARIO_ID) continue;
      expect(
        s.rules?.length ?? 0,
        `${s.id} has no rules block — add at least one authored rule derived from presenting/safety_rationale`,
      ).toBeGreaterThan(0);
    }
  });

  it("every rule passes the shipped evaluator without diagnostics", async () => {
    const { evaluateRules } = await import("@gymbile/wpl-validator");
    for (const s of scenarios) {
      const { diagnostics } = evaluateRules((s.rules ?? []) as never, {
        injuries: ["x"],
      });
      expect(
        diagnostics,
        `${s.id}: ${JSON.stringify(diagnostics)}`,
      ).toHaveLength(0);
    }
  });
});
