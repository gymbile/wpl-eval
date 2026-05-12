import type { Scenario, Violation } from "../lib/types.js";

// `drift_turn` = the first turn at which a blacklist violation appears that
// was NOT present in turn 1. A model that violates from turn 1 doesn't show
// drift — it shows immediate failure (captured elsewhere). Drift requires a
// fresh violation introduced by a later turn in the conversation.
export function firstDriftTurn(
  perTurnViolations: Violation[][],
  _scenario: Scenario,
): number | null {
  const turn1 = new Set(perTurnViolations[0]?.map(violationKey) ?? []);

  for (let i = 1; i < perTurnViolations.length; i++) {
    const turnIViolations = perTurnViolations[i] ?? [];
    const fresh = turnIViolations.find((v) => !turn1.has(violationKey(v)));
    if (fresh) return i + 1; // 1-indexed turn number
  }
  return null;
}

function violationKey(v: Violation): string {
  return `${v.kind}:${v.item}`;
}
