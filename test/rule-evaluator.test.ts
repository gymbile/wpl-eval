// Port of gymbile_backend/test/.../rule_evaluator_test.exs. Every test below
// has a 1:1 counterpart in the Elixir suite. If you change behaviour here,
// also change it in the Elixir RuleEvaluator and vice versa.
//
// NOTE: Retargeted from the local src/lib/rule-evaluator.ts to the shipped
// @gymbile/wpl-validator package (Task 19). The shipped `evaluateRules(rules,
// ctx)` takes a plain rules array and returns `{ evaluated, diagnostics }`.
// The local `evaluate(personalization, ctx)` took an object wrapping the rules.
// All call sites adapted accordingly. `firingActions` is re-exported unchanged
// by the shipped package.

import { describe, test, expect } from "vitest";
import { evaluateRules, firingActions } from "@gymbile/wpl-validator";
import type { ClientContext } from "../src/lib/types.js";

// Helper: build rules array directly (shipped API takes rules[], not a wrapper object)
const rules = (ruleList: unknown[]) => ruleList as never[];
const simple = (field: string, op: string, value: unknown) => ({ field, op, value });
const rule = (condition: unknown, actions: unknown[] = [], id = "rule_x") => ({
  id,
  condition,
  actions,
});
const action = (type: string, extras: Record<string, unknown> = {}) => ({ type, ...extras });

describe("evaluateRules — simple conditions", () => {
  test("eq matches", () => {
    const ctx: ClientContext = { fatigue: "high" };
    const { evaluated } = evaluateRules(rules([rule(simple("fatigue", "eq", "high"), [action("noop")])]), ctx);
    const [r] = evaluated;
    expect(r!.condition_met).toBe(true);
  });

  test("eq does not match different value", () => {
    const ctx: ClientContext = { fatigue: "low" };
    const { evaluated } = evaluateRules(rules([rule(simple("fatigue", "eq", "high"))]), ctx);
    const [r] = evaluated;
    expect(r!.condition_met).toBe(false);
  });

  test("gt / gte / lt / lte work for numbers", () => {
    const ctx: ClientContext = { age: 30 };
    const cases: Array<[string, number, boolean]> = [
      ["gt", 25, true],
      ["gt", 30, false],
      ["gte", 30, true],
      ["lt", 30, false],
      ["lte", 30, true],
    ];
    for (const [op, v, expected] of cases) {
      const { evaluated } = evaluateRules(rules([rule(simple("age", op, v))]), ctx);
      const [r] = evaluated;
      expect(r!.condition_met, `${op} ${v} should be ${expected}`).toBe(expected);
    }
  });

  test("contains matches list membership", () => {
    const ctx: ClientContext = { injuries: ["knee", "shoulder"] };
    const { evaluated } = evaluateRules(rules([rule(simple("injuries", "contains", "knee"))]), ctx);
    const [r] = evaluated;
    expect(r!.condition_met).toBe(true);
  });

  test("not_contains is negation", () => {
    const ctx: ClientContext = { injuries: ["knee"] };
    const { evaluated } = evaluateRules(rules([rule(simple("injuries", "not_contains", "shoulder"))]), ctx);
    const [r] = evaluated;
    expect(r!.condition_met).toBe(true);
  });

  test("null field short-circuits to false (never matches when data missing)", () => {
    const ctx: ClientContext = { weight_kg: null };
    const { evaluated } = evaluateRules(rules([rule(simple("weight", "gt", 50))]), ctx);
    const [r] = evaluated;
    expect(r!.condition_met).toBe(false);
  });

  test("non-numeric comparison with gt/lt is false (no throw)", () => {
    const ctx: ClientContext = { fatigue: "high" };
    const { evaluated } = evaluateRules(rules([rule(simple("fatigue", "gt", 5))]), ctx);
    const [r] = evaluated;
    expect(r!.condition_met).toBe(false);
  });
});

describe("evaluateRules — compound conditions", () => {
  test("AND requires all", () => {
    // NOTE: Shipped package's isCompound detects via `operator` or `conditions`
    // being present (not just `type: "compound"`). The test inputs still work
    // because the shipped engine accepts the `type` key and falls through to
    // the operator-based detection.
    const compound = {
      type: "compound",
      operator: "and",
      conditions: [simple("fatigue", "eq", "high"), simple("age", "gt", 18)],
    };
    const ctxBoth: ClientContext = { fatigue: "high", age: 30 };
    const { evaluated: ev1 } = evaluateRules(rules([rule(compound)]), ctxBoth);
    expect(ev1[0]!.condition_met).toBe(true);

    const ctxOne: ClientContext = { fatigue: "high", age: 16 };
    const { evaluated: ev2 } = evaluateRules(rules([rule(compound)]), ctxOne);
    expect(ev2[0]!.condition_met).toBe(false);
  });

  test("OR matches when any branch matches", () => {
    const compound = {
      type: "compound",
      operator: "or",
      conditions: [simple("injuries", "contains", "knee"), simple("fatigue", "eq", "high")],
    };
    const ctxOne: ClientContext = { injuries: ["knee"] };
    const { evaluated: ev1 } = evaluateRules(rules([rule(compound)]), ctxOne);
    expect(ev1[0]!.condition_met).toBe(true);

    const ctxNone: ClientContext = {};
    const { evaluated: ev2 } = evaluateRules(rules([rule(compound)]), ctxNone);
    expect(ev2[0]!.condition_met).toBe(false);
  });
});

describe("evaluateRules — output shape", () => {
  test("returns one entry per rule with rule_id, met, actions, condition", () => {
    const ruleList = [
      rule(simple("age", "gt", 18), [action("modify_intensity", { factor: 0.8 })], "r1"),
      rule(simple("age", "gt", 100), [action("noop")], "r2"),
    ];
    const ctx: ClientContext = { age: 30 };
    const { evaluated } = evaluateRules(rules(ruleList), ctx);
    const [r1, r2] = evaluated;

    expect(r1!.rule_id).toBe("r1");
    expect(r1!.condition_met).toBe(true);
    // NOTE: The shipped evaluator emits UNKNOWN_ACTION_TYPE diagnostics for
    // `modify_intensity` and `noop` (not in the applicator set), but still
    // includes them in evaluated[].actions. The shape assertion is unchanged.
    expect(r1!.actions).toEqual([{ type: "modify_intensity", factor: 0.8 }]);
    expect(r2!.rule_id).toBe("r2");
    expect(r2!.condition_met).toBe(false);
  });

  test("handles empty rules array", () => {
    // NOTE: Shipped API takes rules[] directly. Passing null/undefined produces
    // an empty evaluated array (same semantics as the local evaluate()).
    expect(evaluateRules([], {}).evaluated).toEqual([]);
    expect(evaluateRules(null, {}).evaluated).toEqual([]);
    expect(evaluateRules(undefined, {}).evaluated).toEqual([]);
  });

  test("null condition always fires (missing condition = always applies)", () => {
    const { evaluated } = evaluateRules(rules([rule(null, [action("noop")])]), {});
    expect(evaluated[0]!.condition_met).toBe(true);
  });
});

describe("firingActions", () => {
  test("returns only actions from rules whose conditions matched", () => {
    const evaluated = [
      { rule_id: "r1", condition_met: true, actions: [{ type: "a" }], condition: null },
      { rule_id: "r2", condition_met: false, actions: [{ type: "b" }], condition: null },
      {
        rule_id: "r3",
        condition_met: true,
        actions: [{ type: "c" }, { type: "d" }],
        condition: null,
      },
    ];
    expect(firingActions(evaluated)).toEqual([{ type: "a" }, { type: "c" }, { type: "d" }]);
  });
});
