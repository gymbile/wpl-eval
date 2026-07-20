import type { ClientContext, Scenario } from "./types.js";

// Lifecycle state helpers (v0.7). Pure functions — no I/O, no LLM calls —
// so the merge/replacement semantics are unit-testable in isolation.
// Semantics (see the v0.7.0 design spec):
//   - context overlays apply in ascending turn order, shallow-merged;
//     `cycle` is replaced wholesale (a cycle change is a full re-description).
//   - a turn state's `rules` REPLACES the active rule set from that turn
//     onward; absence retains the previous set.

export function isLifecycle(s: Scenario): boolean {
  return Array.isArray(s.turn_states) && s.turn_states.length > 0;
}

export function mergeContextAtTurn(
  base: ClientContext,
  scenario: Scenario,
  turn: number,
): ClientContext {
  let ctx: ClientContext = { ...base };
  for (const ts of scenario.turn_states ?? []) {
    if (ts.turn > turn) break; // turn_states are validated ascending
    if (ts.context) ctx = { ...ctx, ...ts.context };
  }
  return ctx;
}

export function activeRulesAtTurn(
  scenario: Scenario,
  turn: number,
): NonNullable<Scenario["rules"]> {
  let rules = scenario.rules ?? [];
  for (const ts of scenario.turn_states ?? []) {
    if (ts.turn > turn) break;
    if (ts.rules) rules = ts.rules;
  }
  return rules;
}

// Throws on invalid lifecycle authoring. Called at scenario load time —
// before any LLM call — so a misconfigured scenario can never produce a
// silently-meaningless trial. `vocab`, when provided, must contain every
// slug referenced by criteria and rule actions.
export function validateLifecycleScenario(
  scenario: Scenario,
  vocab?: ReadonlySet<string>,
): void {
  const states = scenario.turn_states;
  const criteria = scenario.lifecycle_criteria;
  if (!states && !criteria) return; // not a lifecycle scenario
  const fail = (msg: string): never => {
    throw new Error(`lifecycle scenario ${scenario.id}: ${msg}`);
  };
  if (!states?.length) fail("lifecycle_criteria present but turn_states missing");
  if (!criteria?.length) fail("turn_states present but lifecycle_criteria missing");
  const lastTurn = scenario.multi_turn.length;

  let prev = 0;
  for (const ts of states!) {
    if (!Number.isInteger(ts.turn) || ts.turn < 1 || ts.turn > lastTurn) {
      fail(`turn ${ts.turn} outside 1..${lastTurn}`);
    }
    if (ts.turn <= prev) fail(`turn_states must be strictly ascending (turn ${ts.turn})`);
    prev = ts.turn;
  }

  const slugs: string[] = [];
  for (const c of criteria!) {
    const to = c.to_turn ?? lastTurn;
    if (c.from_turn < 1 || c.from_turn > lastTurn || to > lastTurn) {
      fail(`criterion ${c.id}: turn bounds outside 1..${lastTurn}`);
    }
    if (c.from_turn > to) fail(`criterion ${c.id}: from_turn > to_turn`);
    if (c.weeks && c.weeks.from > c.weeks.to) fail(`criterion ${c.id}: weeks.from > weeks.to`);
    slugs.push(...(c.must_not_contain ?? []), ...(c.must_eventually_contain ?? []));
  }
  for (const ts of states!) {
    for (const r of ts.rules ?? []) {
      for (const a of r.actions) {
        if (a.type === "forbid_exercise" && typeof a["exercise"] === "string") {
          slugs.push(a["exercise"] as string);
        }
      }
    }
  }
  if (vocab) {
    for (const slug of slugs) {
      if (!vocab.has(slug)) fail(`slug not in canonical vocab: ${slug}`);
    }
  }
}
