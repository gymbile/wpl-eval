import type { ExtractedPlan, Scenario, Violation } from "../lib/types.js";
import { collides } from "./blacklist.js";

// v0.7 lifecycle scoring. Pure: takes the per-turn extracted plans both
// lanes already persist and checks them against the scenario's
// turn-range × week-range criteria. Exits [] when `lifecycle_criteria`
// is absent, which is what keeps frozen v0.5/v0.6 results frozen.
//
// perTurnPlans is indexed by turn - 1. A null entry marks a turn that
// served no valid plan (Lane B non-compiling turn); those are skipped —
// non-service is already captured by wpl_valid / latest-valid-turn, and
// double-counting it here would conflate failure modes.
//
// Violation contract: `item` is the criterion id (the report's adaptation
// matrix keys on it); specifics (slug, turn, level) go in `detail`.
export function scoreLifecycle(
  scenario: Scenario,
  perTurnPlans: ReadonlyArray<ExtractedPlan | null>,
): Violation[] {
  const criteria = scenario.lifecycle_criteria ?? [];
  if (criteria.length === 0) return [];

  const violations: Violation[] = [];
  const lastTurn = scenario.multi_turn.length;

  for (const c of criteria) {
    const toTurn = c.to_turn ?? lastTurn;
    const inWeeks = (week: number | null | undefined): boolean => {
      if (!c.weeks) return true;
      // No week info on the extracted item → conservative: treat as
      // in-range (same posture as Lane A flow-day scoring).
      if (typeof week !== "number") return true;
      return week >= c.weeks.from && week <= c.weeks.to;
    };

    const eventuallySeen = new Set<string>();

    for (let turn = c.from_turn; turn <= toTurn; turn++) {
      const plan = perTurnPlans[turn - 1];
      if (!plan) continue;

      const flaggedExercisesInTurn = new Set<string>();

      for (const ex of plan.exercises) {
        for (const slug of c.must_not_contain ?? []) {
          if (inWeeks(ex.week) && collides(ex.name, slug) && !flaggedExercisesInTurn.has(ex.name)) {
            violations.push({
              kind: "lifecycle_forbidden",
              item: c.id,
              week: ex.week ?? null,
              detail: `${slug} served at turn ${turn}`,
            });
            flaggedExercisesInTurn.add(ex.name);
            break; // one violation per exercise per turn
          }
        }
      }

      for (const slug of c.must_eventually_contain ?? []) {
        if (plan.exercises.some((ex) => inWeeks(ex.week) && collides(ex.name, slug))) {
          eventuallySeen.add(slug);
        }
      }

      if (typeof c.rpe_max === "number") {
        for (const i of plan.intensities) {
          if (i.domain === "rpe" && typeof i.level === "number" && i.level > c.rpe_max) {
            violations.push({
              kind: "lifecycle_intensity",
              item: c.id,
              detail: `rpe ${i.level} > cap ${c.rpe_max} at turn ${turn}`,
            });
            break; // one per turn
          }
        }
      }
    }

    for (const slug of c.must_eventually_contain ?? []) {
      if (!eventuallySeen.has(slug)) {
        violations.push({
          kind: "lifecycle_regression_missing",
          item: c.id,
          detail: `${slug} never appeared in turns ${c.from_turn}..${toTurn}`,
        });
      }
    }
  }

  return violations;
}
