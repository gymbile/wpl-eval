// Port of gymbile_backend/test/.../rule_evaluator_test.exs. Every test below
// has a 1:1 counterpart in the Elixir suite. If you change behaviour here,
// also change it in the Elixir RuleEvaluator and vice versa.

import { describe, test, expect } from "vitest";
import { evaluate, firingActions, type EvaluatedRule } from "../src/lib/rule-evaluator.js";
import type { ClientContext } from "../src/lib/types.js";

const pers = (rules: unknown[]) => ({ rules: rules as never });
const simple = (field: string, op: string, value: unknown) => ({ field, op, value });
const rule = (condition: unknown, actions: unknown[] = [], id = "rule_x") => ({
  id,
  condition,
  actions,
});
const action = (type: string, extras: Record<string, unknown> = {}) => ({ type, ...extras });

describe("evaluate — simple conditions", () => {
  test("eq matches", () => {
    const ctx: ClientContext = { fatigue: "high" };
    const [r] = evaluate(pers([rule(simple("fatigue", "eq", "high"), [action("noop")])]), ctx);
    expect(r!.condition_met).toBe(true);
  });

  test("eq does not match different value", () => {
    const ctx: ClientContext = { fatigue: "low" };
    const [r] = evaluate(pers([rule(simple("fatigue", "eq", "high"))]), ctx);
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
      const [r] = evaluate(pers([rule(simple("age", op, v))]), ctx);
      expect(r!.condition_met, `${op} ${v} should be ${expected}`).toBe(expected);
    }
  });

  test("contains matches list membership", () => {
    const ctx: ClientContext = { injuries: ["knee", "shoulder"] };
    const [r] = evaluate(pers([rule(simple("injuries", "contains", "knee"))]), ctx);
    expect(r!.condition_met).toBe(true);
  });

  test("not_contains is negation", () => {
    const ctx: ClientContext = { injuries: ["knee"] };
    const [r] = evaluate(pers([rule(simple("injuries", "not_contains", "shoulder"))]), ctx);
    expect(r!.condition_met).toBe(true);
  });

  test("null field short-circuits to false (never matches when data missing)", () => {
    const ctx: ClientContext = { weight_kg: null };
    const [r] = evaluate(pers([rule(simple("weight", "gt", 50))]), ctx);
    expect(r!.condition_met).toBe(false);
  });

  test("non-numeric comparison with gt/lt is false (no throw)", () => {
    const ctx: ClientContext = { fatigue: "high" };
    const [r] = evaluate(pers([rule(simple("fatigue", "gt", 5))]), ctx);
    expect(r!.condition_met).toBe(false);
  });
});

describe("evaluate — compound conditions", () => {
  test("AND requires all", () => {
    const compound = {
      type: "compound",
      operator: "and",
      conditions: [simple("fatigue", "eq", "high"), simple("age", "gt", 18)],
    };
    const ctxBoth: ClientContext = { fatigue: "high", age: 30 };
    const [r1] = evaluate(pers([rule(compound)]), ctxBoth);
    expect(r1!.condition_met).toBe(true);

    const ctxOne: ClientContext = { fatigue: "high", age: 16 };
    const [r2] = evaluate(pers([rule(compound)]), ctxOne);
    expect(r2!.condition_met).toBe(false);
  });

  test("OR matches when any branch matches", () => {
    const compound = {
      type: "compound",
      operator: "or",
      conditions: [simple("injuries", "contains", "knee"), simple("fatigue", "eq", "high")],
    };
    const ctxOne: ClientContext = { injuries: ["knee"] };
    const [r1] = evaluate(pers([rule(compound)]), ctxOne);
    expect(r1!.condition_met).toBe(true);

    const ctxNone: ClientContext = {};
    const [r2] = evaluate(pers([rule(compound)]), ctxNone);
    expect(r2!.condition_met).toBe(false);
  });
});

describe("evaluate — output shape", () => {
  test("returns one entry per rule with rule_id, met, actions, condition", () => {
    const rules = [
      rule(simple("age", "gt", 18), [action("modify_intensity", { factor: 0.8 })], "r1"),
      rule(simple("age", "gt", 100), [action("noop")], "r2"),
    ];
    const ctx: ClientContext = { age: 30 };
    const [r1, r2] = evaluate(pers(rules), ctx);

    expect(r1!.rule_id).toBe("r1");
    expect(r1!.condition_met).toBe(true);
    expect(r1!.actions).toEqual([{ type: "modify_intensity", factor: 0.8 }]);
    expect(r2!.rule_id).toBe("r2");
    expect(r2!.condition_met).toBe(false);
  });

  test("handles personalization without rules", () => {
    expect(evaluate({}, {})).toEqual([]);
    expect(evaluate(null, {})).toEqual([]);
    expect(evaluate(undefined, {})).toEqual([]);
  });

  test("null condition always fires (missing condition = always applies)", () => {
    const [r] = evaluate(pers([rule(null, [action("noop")])]), {});
    expect(r!.condition_met).toBe(true);
  });
});

describe("firingActions", () => {
  test("returns only actions from rules whose conditions matched", () => {
    const evaluated: EvaluatedRule[] = [
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
