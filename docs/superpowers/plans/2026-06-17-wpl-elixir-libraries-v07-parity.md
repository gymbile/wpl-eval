# WPL Elixir Libraries v0.7 Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for this plan. Each task runs in a fresh subagent with two-stage review. Steps use checkbox (`- [ ]`).

**Goal:** Bring `wpl_validator` 1.7.1 → 1.8.0 and `wpl_ai` 1.13.0 → 2.0.0, achieving exact behavioral parity with `@gymbile/wpl-validator@1.8.0` and `@gymbile/wpl-ai@2.0.0` as shipped to npm. The enforcement fixtures in `priv/conformance/enforcement/` become the cross-language safety contract.

**Architecture:** Both are pure-Elixir Hex libraries, no OTP processes. `wpl_validator` owns Pass-1 (JSON Schema), Pass-2 (semantic rules via `WalkContext` walk), and the new Pass-3 (`WPL.Enforce` modules). `wpl_ai` owns lexer/parser/compiler/validator; its public entry point is `WplAi.to_wpl/1`. The two libraries are independent on Hex but `wpl_ai`'s safety-invariant test depends on `wpl_validator ~> 1.8` in `:test`.

**Tech Stack:** Elixir, ExUnit, mix.

---

## Execution rules for the worker

1. **Work order**: complete ALL tasks in `wpl-validator-ex` (V1–V6) fully before starting `wpl-ai-ex` (A1–A5). The safety-invariant test in A4 calls `WPL.Enforce.enforce/4` — that function must exist and be tested before the wpl-ai test can even compile.
2. **Branch**: before the first task in each repo, create branch `v0.7-elixir-parity` from `main`.
   ```
   git -C /Users/alex/Projects/my/gymbile.com/wpl-validator-ex checkout -b v0.7-elixir-parity
   git -C /Users/alex/Projects/my/gymbile.com/wpl-ai-ex checkout -b v0.7-elixir-parity
   ```
3. **NEVER** run `git push`, `mix hex.publish`, or create a version tag. Publishing is gated behind the user's `v*` tag → `.github/workflows/publish.yml` pipeline.
4. **Commit style**: plain conventional commits (`feat:`, `fix:`, `test:`, `chore:`). No AI attribution lines.
5. **Quality gate per task** (run all three; if any fails, fix before committing):
   ```
   mix compile --warnings-as-errors
   mix format --check-formatted
   mix test
   ```
6. **Reality adaptation**: if a file path, module name, or function signature differs from what the plan states, adapt minimally and add a one-line `# [ADAPTED]` comment noting the drift. Do not rewrite large sections of pre-existing code.
7. **TDD discipline**: write the failing test first, confirm it fails, then implement, then confirm it passes. Every step must show the actual test output confirming the expected state.

---

## wpl-validator-ex Tasks

Repo root: `/Users/alex/Projects/my/gymbile.com/wpl-validator-ex`

---

### V1 — Sync vendored schema to 1.7.0

**Purpose:** The vendored schema is currently at v1.5.0 (per `priv/schema-version.txt`). The WPL schema v1.7.0 adds `forbid_exercise` to the `Action.type` enum, `in`/`not_in` ops to `SimpleCondition`, nested `CompoundCondition`, and typed `forbid_exercise` payload — all required for the enforcement fixtures to pass schema validation.

**Files:**
- `priv/schema/v1.schema.json` — replace with `/Users/alex/Projects/my/gymbile.com/wpl/schema/v1.schema.json`
- `priv/schema-version.txt` — update text to `v1.7.0`

**Steps:**

- [ ] Copy the current WPL schema into place:
  ```bash
  cp /Users/alex/Projects/my/gymbile.com/wpl/schema/v1.schema.json \
     /Users/alex/Projects/my/gymbile.com/wpl-validator-ex/priv/schema/v1.schema.json
  printf 'v1.7.0\n' > /Users/alex/Projects/my/gymbile.com/wpl-validator-ex/priv/schema-version.txt
  ```

- [ ] Run the existing conformance suite to detect regressions:
  ```bash
  cd /Users/alex/Projects/my/gymbile.com/wpl-validator-ex && mix test test/conformance_test.exs
  ```
  The new schema changes `modify_intensity` action to require a numeric `factor` field (`"required": ["factor"]`). Any existing valid fixture that contains a `modify_intensity` action without `factor` will now produce a `SCHEMA_VIOLATION`. Inspect failures and update the relevant fixture or expected file if needed. The `valid/personalization-valid.json` fixture is most at risk.

- [ ] Verify `priv/conformance/valid/personalization-valid.json` (if it exists) does not include a bare `modify_intensity` action without `factor`. If it does, add `"factor": 0.85` to that action in the fixture (this is a schema-correct repair, not a test change).

- [ ] Run full test suite and confirm it passes:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "chore: sync vendored schema to WPL v1.7.0"
  ```

---

### V2 — Accept `forbid_exercise` in InvalidPersonalizationRule; confirm `in`/`not_in` pass

**Purpose:** `@action_types` in `WPL.Validator.Rules.InvalidPersonalizationRule` does not include `"forbid_exercise"` (line 7–18 of `lib/wpl/validator/rules/invalid_personalization_rule.ex`). It needs to be added. The TS `invalid-personalization-rule.ts` line 4 shows `forbid_exercise` in its `ACTION_TYPES` set. The `in`/`not_in` ops exist in the schema but the `InvalidPersonalizationRule` has no op-value validation, so they already pass silently — add a test confirming this.

**Files:**
- `lib/wpl/validator/rules/invalid_personalization_rule.ex`
- `test/wpl/validator/rules/invalid_personalization_rule_test.exs`

**Steps:**

- [ ] Write a failing test for `forbid_exercise` action type:
  ```elixir
  # In test/wpl/validator/rules/invalid_personalization_rule_test.exs
  # Inside describe "InvalidPersonalizationRule.enter_personalization_rule/3"

  test "accepts forbid_exercise action type (was incorrectly rejected pre-1.8.0)" do
    rule = %{
      "id" => "forbid_high_impact",
      "condition" => %{"field" => "injuries", "op" => "contains", "value" => "torn_meniscus"},
      "actions" => [%{"type" => "forbid_exercise", "exercise" => "pistol_squat"}]
    }

    assert run_on_rule(rule) == []
  end
  ```
  Run: `mix test test/wpl/validator/rules/invalid_personalization_rule_test.exs` — expect this test to FAIL (errors returned because `"forbid_exercise"` is currently not in `@action_types`).

- [ ] Write a passing test confirming `in` and `not_in` ops do not error:
  ```elixir
  test "accepts in and not_in ops in SimpleCondition without error" do
    rule = %{
      "id" => "cycle_window",
      "condition" => %{"field" => "cycle_day", "op" => "in", "value" => [1, 2, 3]},
      "actions" => [%{"type" => "forbid_exercise", "exercise" => "romanian_deadlift"}]
    }

    # Will fail until forbid_exercise is accepted; once V2 implement step runs,
    # this test asserts the complete clean path.
    assert run_on_rule(rule) == []
  end

  test "accepts not_in op in SimpleCondition without error" do
    rule = %{
      "id" => "not_in_test",
      "condition" => %{"field" => "fatigue", "op" => "not_in", "value" => ["high", "extreme"]},
      "actions" => [%{"type" => "reduce_reps", "scope" => "activity"}]
    }

    assert run_on_rule(rule) == []
  end
  ```

- [ ] Implement: add `"forbid_exercise"` to the `@action_types` MapSet in `lib/wpl/validator/rules/invalid_personalization_rule.ex`:
  ```elixir
  @action_types MapSet.new([
                  "forbid_exercise",
                  "modify_intensity",
                  "add_warmup_time",
                  "increase_rest",
                  "reduce_sets",
                  "reduce_reps",
                  "replace_exercise",
                  "exclude_exercise",
                  "modify_exercise",
                  "use_schedule",
                  "add_activity"
                ])
  ```

- [ ] Run tests: `mix test test/wpl/validator/rules/invalid_personalization_rule_test.exs` — expect all tests to PASS.

- [ ] Run quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "feat: accept forbid_exercise in InvalidPersonalizationRule; test in/not_in ops"
  ```

---

### V3 — Strict catalog mode (`require_catalog` option + case-insensitive resolution)

**Purpose:** Port the TS `unresolved-ref.ts` `requireCatalog` + case-insensitive `hasRef` behavior. Two changes to `WPL.Validator.Rules.UnresolvedRef`:
1. When `opts` contains `require_catalog: true` AND no `:catalog` is supplied, emit `:catalog_required` per-ref (severity `:error`).
2. Make catalog membership case-insensitive (lowercase-fold both sides).
Both changes require adding `:catalog_required` to the `@type code` in `WPL.Validator.Error`.

**Files:**
- `lib/wpl/validator/error.ex`
- `lib/wpl/validator/rules/unresolved_ref.ex`
- `priv/conformance/error-codes.md`
- `test/wpl/validator/rules/unresolved_ref_test.exs`

**Steps:**

- [ ] Write failing tests (add to `describe "UnresolvedRef.enter_activity/3"`):
  ```elixir
  test "emits catalog_required when require_catalog: true and no catalog supplied" do
    activity = %{
      "type" => "exercise",
      "exercise_ref" => "push_up"
    }

    errors = run_on_activity(activity, require_catalog: true)
    assert length(errors) == 1
    err = hd(errors)
    assert err.code == :catalog_required
    assert err.severity == :error
    assert err.meta.ref_kind == "exercise"
    assert err.meta.ref_value == "push_up"
  end

  test "does not emit catalog_required when require_catalog not set and no catalog" do
    activity = %{"type" => "exercise", "exercise_ref" => "push_up"}
    assert run_on_activity(activity) == []
  end

  test "resolves exercise_ref case-insensitively" do
    activity = %{"type" => "exercise", "exercise_ref" => "Push_Up"}
    catalog = %{exercises: MapSet.new(["push_up"])}
    assert run_on_activity(activity, catalog: catalog) == []
  end

  test "flags ref whose lowercase form is absent from catalog" do
    activity = %{"type" => "exercise", "exercise_ref" => "totally_unknown_exercise"}
    catalog = %{exercises: MapSet.new(["push_up", "squat"])}
    errors = run_on_activity(activity, catalog: catalog)
    assert length(errors) == 1
    assert hd(errors).code == :unresolved_ref
  end
  ```
  Run: `mix test test/wpl/validator/rules/unresolved_ref_test.exs` — expect new tests to FAIL.

- [ ] Add `:catalog_required` to the `@type code` union in `lib/wpl/validator/error.ex`:
  ```elixir
  @type code ::
          :schema_violation
          | :duplicate_id
          | :unresolved_ref
          | :catalog_required
          | :empty_phases_for_type
          | :invalid_prescription
          | :invalid_personalization_rule
          | :invalid_points_rule
          | :phase_duration_mismatch
          | :cyclic_subplan
          | :activity_block_mismatch
  ```

- [ ] Rewrite `lib/wpl/validator/rules/unresolved_ref.ex` with case-insensitive resolution and `require_catalog` mode:
  ```elixir
  defmodule WPL.Validator.Rules.UnresolvedRef do
    @moduledoc false
    use WPL.Validator.Rule

    alias WPL.Validator.{Error, WalkContext}

    @ref_kinds [
      {"exercise_ref", "exercise", :exercises},
      {"meal_ref", "meal", :meals},
      {"meditation_ref", "meditation", :meditations}
    ]

    @impl true
    def enter_activity(ctx, activity, path) do
      catalog = Keyword.get(ctx.opts, :catalog)
      require_catalog = Keyword.get(ctx.opts, :require_catalog, false)

      Enum.reduce(@ref_kinds, ctx, fn {field, kind, catalog_key}, acc ->
        check_ref(acc, activity, path, field, kind, catalog_key, catalog, require_catalog)
      end)
    end

    defp check_ref(ctx, activity, path, field, kind, catalog_key, catalog, require_catalog) do
      ref_value = Map.get(activity, field)

      if is_binary(ref_value) do
        if catalog == nil do
          if require_catalog do
            WalkContext.emit(ctx, %Error{
              path: "#{path}/#{field}",
              code: :catalog_required,
              message:
                "catalog is required in strict mode but was not provided; " <>
                  "cannot resolve #{kind} '#{ref_value}'",
              severity: :error,
              meta: %{ref_kind: kind, ref_value: ref_value}
            })
          else
            ctx
          end
        else
          catalog_set = Map.get(catalog, catalog_key)
          resolved = has_ref?(catalog_set, ref_value)

          if resolved do
            ctx
          else
            WalkContext.emit(ctx, %Error{
              path: "#{path}/#{field}",
              code: :unresolved_ref,
              message: "#{kind} '#{ref_value}' not found in catalog",
              severity: :error,
              meta: %{ref_kind: kind, ref_value: ref_value}
            })
          end
        end
      else
        ctx
      end
    end

    # Case-insensitive membership: try exact first, then lowercase-fold both sides.
    defp has_ref?(nil, _ref), do: false
    defp has_ref?(set, ref) when is_struct(set, MapSet) do
      if MapSet.member?(set, ref) do
        true
      else
        ref_lower = String.downcase(ref)
        Enum.any?(set, fn entry -> String.downcase(entry) == ref_lower end)
      end
    end
    defp has_ref?(_set, _ref), do: false
  end
  ```

- [ ] Also thread `require_catalog` through `WPL.Validator.validate/2` by updating the `@spec` and `@type opts`:
  ```elixir
  # In lib/wpl/validator.ex — update the type spec
  @type opts :: [catalog: catalog(), require_catalog: boolean()]
  ```
  No implementation change needed in `validate/2` itself — `opts` passes through to `Pass2.run/2` → `WalkContext.opts` already.

- [ ] Add `CATALOG_REQUIRED` prose to `priv/conformance/error-codes.md` under Pass 2, after `UNRESOLVED_REF`:
  ```markdown
  ### `CATALOG_REQUIRED`

  Emitted only when `require_catalog: true` is passed to `validate/2` and no catalog
  is supplied, but an activity references a `*_ref` field. In non-strict mode (the
  default) a missing catalog silently skips ref resolution.

  - **severity**: `error`
  - **path**: pointer to the activity's `*_ref` field
  - **meta**:
    - `ref_kind` (string) — `exercise` | `meal` | `meditation`
    - `ref_value` (string) — the ref that could not be checked
  ```

- [ ] Run tests and quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "feat: strict catalog mode (require_catalog) + case-insensitive ref resolution"
  ```

---

### V4 — Port Pass-3 enforce engine as `WPL.Enforce.*`

**Purpose:** Port the TS `src/enforce/` directory (matcher.ts, rule-evaluator.ts, cycle.ts, index.ts) as idiomatic Elixir modules. All functions are pure; no GenServers. The `WPL.Enforce` module is the public entry point.

**Files (all new):**
- `lib/wpl/enforce/matcher.ex`
- `lib/wpl/enforce/rule_evaluator.ex`
- `lib/wpl/enforce/cycle.ex`
- `lib/wpl/enforce.ex`
- `test/wpl/enforce/matcher_test.exs`
- `test/wpl/enforce/rule_evaluator_test.exs`
- `test/wpl/enforce/cycle_test.exs`
- `test/wpl/enforce_test.exs`

#### V4a — `WPL.Enforce.Matcher`

- [ ] Write `test/wpl/enforce/matcher_test.exs` (failing):
  ```elixir
  defmodule WPL.Enforce.MatcherTest do
    use ExUnit.Case, async: true

    alias WPL.Enforce.Matcher

    describe "normalize/1" do
      test "lowercases and underscores free-text names" do
        assert Matcher.normalize("Jump Squat") == "jump_squat"
      end

      test "strips stop articles" do
        assert Matcher.normalize("The Squat") == "squat"
      end

      test "strips punctuation" do
        assert Matcher.normalize("bench-press!") == "bench_press"
      end

      test "deduplicates repeated separators" do
        assert Matcher.normalize("push  up") == "push_up"
      end
    end

    describe "stem_plural/1" do
      test "stems trailing s (squats -> squat)" do
        assert Matcher.stem_plural("squats") == "squat"
      end

      test "preserves ss endings (press stays press)" do
        assert Matcher.stem_plural("press") == "press"
      end

      test "preserves biceps" do
        assert Matcher.stem_plural("biceps") == "biceps"
      end

      test "preserves abs (3-char, not in SHORT_PLURALS)" do
        assert Matcher.stem_plural("abs") == "abs"
      end

      test "stems ups via SHORT_PLURALS (compound plural fix)" do
        assert Matcher.stem_plural("ups") == "up"
      end

      test "normalize push_ups -> push_up via SHORT_PLURALS" do
        assert Matcher.normalize("push_ups") == "push_up"
      end

      test "stems ies -> y (butterflies -> butterfly)" do
        assert Matcher.stem_plural("butterflies") == "butterfly"
      end
    end

    describe "collides/2" do
      test "exact match collides" do
        assert Matcher.collides("pistol_squat", "pistol_squat")
      end

      test "free-text name collides with catalog entry" do
        assert Matcher.collides("Bulgarian Split Squats", "bulgarian_split_squat_below_parallel")
      end

      test "Push Ups collides with push_up (compound plural fix)" do
        assert Matcher.collides("Push Ups", "push_up")
      end

      test "bench_press does not collide with pistol_squat" do
        refute Matcher.collides("bench_press", "pistol_squat")
      end

      test "_anything suffix: any core token is enough" do
        assert Matcher.collides("kettlebell_swing", "kettlebell_anything")
      end

      test "_anything: unrelated exercise does not collide" do
        refute Matcher.collides("squat", "kettlebell_anything")
      end

      test "empty extracted string never collides" do
        refute Matcher.collides("", "push_up")
      end
    end
  end
  ```
  Run: `mix test test/wpl/enforce/matcher_test.exs` — expect FAIL (module missing).

- [ ] Create `lib/wpl/enforce/matcher.ex`:
  ```elixir
  defmodule WPL.Enforce.Matcher do
    @moduledoc """
    Fuzzy exercise-name matcher for the Pass-3 enforcement engine.

    Ported from wpl-validator-ts/src/enforce/matcher.ts. Pure functions.
    Any change here is a change to the safety contract — add a conformance
    fixture with every behavioral change.
    """

    @doc "Normalize a free-text name into a lowercase, underscore-separated token."
    @spec normalize(String.t()) :: String.t()
    def normalize(s) do
      s
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9\s_-]/, " ")
      |> String.replace(~r/\b(the|a|an|with|of|to)\b/, " ")
      |> String.trim()
      |> String.split(~r/[\s_-]+/)
      |> Enum.filter(&(&1 != ""))
      |> Enum.map(&stem_plural/1)
      |> Enum.join("_")
    end

    # Short plurals (<=3 chars) that ARE genuine plurals and must still stem.
    # The <=3 length guard below normally protects short tokens; this map
    # overrides that guard so compound names like "push_ups" match "push_up".
    # "abs" is deliberately NOT here: it is a canonical muscle-group token.
    @short_plurals %{"ups" => "up"}

    @doc "Strip a trailing English plural 's' from a token."
    @spec stem_plural(String.t()) :: String.t()
    def stem_plural(token) do
      len = String.length(token)

      cond do
        len <= 3 ->
          Map.get(@short_plurals, token, token)

        String.ends_with?(token, "ss") or String.ends_with?(token, "us") or
            String.ends_with?(token, "is") ->
          token

        String.ends_with?(token, "ies") ->
          String.slice(token, 0, len - 3) <> "y"

        String.ends_with?(token, "es") and len > 4 ->
          String.slice(token, 0, len - 2)

        String.ends_with?(token, "s") ->
          String.slice(token, 0, len - 1)

        true ->
          token
      end
    end

    @qualifier_tokens MapSet.new([
      "below", "above", "deep", "heavy", "light", "weighted", "loaded",
      "max", "maximal", "parallel", "bodyweight", "kg", "lbs", "rom",
      "anything", "any"
    ])

    defp core_tokens(blacklisted) do
      tokens =
        blacklisted
        |> normalize()
        |> String.split("_")
        |> Enum.filter(&(&1 != ""))

      pivot = Enum.find_index(tokens, &MapSet.member?(@qualifier_tokens, &1))

      if pivot == nil do
        tokens
      else
        Enum.take(tokens, pivot)
      end
    end

    @doc """
    Returns true when `extracted` (an exercise name from the plan) collides with
    `blacklisted` (a forbid pattern from a personalization rule).
    """
    @spec collides(String.t(), String.t()) :: boolean()
    def collides(extracted, blacklisted) do
      a = normalize(extracted)
      if a == "", do: false, else: do_collides(a, blacklisted)
    end

    defp do_collides(a, blacklisted) do
      core = core_tokens(blacklisted)
      if core == [], do: false, else: check_collides(a, blacklisted, core)
    end

    defp check_collides(a, blacklisted, core) do
      b = normalize(blacklisted)
      if a == b do
        true
      else
        a_tokens = a |> String.split("_") |> Enum.filter(&(&1 != ""))
        a_set = MapSet.new(a_tokens)

        if String.ends_with?(blacklisted, "_anything") do
          Enum.any?(core, &MapSet.member?(a_set, &1))
        else
          Enum.all?(core, &MapSet.member?(a_set, &1))
        end
      end
    end
  end
  ```

- [ ] Run matcher tests: `mix test test/wpl/enforce/matcher_test.exs` — expect PASS.

#### V4b — `WPL.Enforce.RuleEvaluator`

- [ ] Write `test/wpl/enforce/rule_evaluator_test.exs` (failing):
  ```elixir
  defmodule WPL.Enforce.RuleEvaluatorTest do
    use ExUnit.Case, async: true

    alias WPL.Enforce.RuleEvaluator

    defp eval(rules, ctx) do
      RuleEvaluator.evaluate_rules(rules, ctx)
    end

    describe "evaluate_rules/2" do
      test "nil condition always fires" do
        rules = [%{"id" => "r1", "condition" => nil, "actions" => [%{"type" => "forbid_exercise", "exercise" => "squat"}]}]
        %{evaluated: [result], diagnostics: []} = eval(rules, %{})
        assert result.condition_met == true
      end

      test "condition met when field matches" do
        rules = [%{
          "id" => "r1",
          "condition" => %{"field" => "age", "op" => "gt", "value" => 60},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "squat"}]
        }]
        %{evaluated: [result]} = eval(rules, %{age: 65})
        assert result.condition_met == true
      end

      test "condition not met when field does not match" do
        rules = [%{
          "id" => "r1",
          "condition" => %{"field" => "age", "op" => "gt", "value" => 60},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "squat"}]
        }]
        %{evaluated: [result]} = eval(rules, %{age: 30})
        assert result.condition_met == false
      end

      test "in op matches when actual is in list" do
        rules = [%{
          "id" => "r1",
          "condition" => %{"field" => "cycle_day", "op" => "in", "value" => [1, 2, 3]},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "rdl"}]
        }]
        %{evaluated: [result]} = eval(rules, %{cycle_day: 2})
        assert result.condition_met == true
      end

      test "unknown condition field emits UNKNOWN_CONDITION_FIELD diagnostic" do
        rules = [%{
          "id" => "bad_rule",
          "condition" => %{"field" => "injures", "op" => "contains", "value" => "torn_meniscus"},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "squat"}]
        }]
        %{evaluated: [result], diagnostics: diags} = eval(rules, %{injuries: ["torn_meniscus"]})
        assert result.condition_met == false
        assert length(diags) == 1
        assert hd(diags).code == "UNKNOWN_CONDITION_FIELD"
        assert hd(diags).rule_id == "bad_rule"
      end

      test "action with non-string type emits UNKNOWN_ACTION_TYPE diagnostic" do
        rules = [%{
          "id" => "r1",
          "condition" => nil,
          "actions" => [%{"type" => 42}]
        }]
        %{diagnostics: diags} = eval(rules, %{})
        assert Enum.any?(diags, &(&1.code == "UNKNOWN_ACTION_TYPE"))
      end

      test "contains op works for list field" do
        rules = [%{
          "id" => "r1",
          "condition" => %{"field" => "injuries", "op" => "contains", "value" => "torn_meniscus"},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "squat"}]
        }]
        %{evaluated: [result]} = eval(rules, %{injuries: ["torn_meniscus", "bad_back"]})
        assert result.condition_met == true
      end

      test "nil field value short-circuits to false" do
        rules = [%{
          "id" => "r1",
          "condition" => %{"field" => "weight", "op" => "gt", "value" => 50},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "squat"}]
        }]
        %{evaluated: [result]} = eval(rules, %{})
        assert result.condition_met == false
      end

      test "compound AND condition" do
        rules = [%{
          "id" => "r1",
          "condition" => %{
            "operator" => "and",
            "conditions" => [
              %{"field" => "age", "op" => "gt", "value" => 50},
              %{"field" => "injuries", "op" => "contains", "value" => "knee"}
            ]
          },
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "squat"}]
        }]
        %{evaluated: [result]} = eval(rules, %{age: 55, injuries: ["knee"]})
        assert result.condition_met == true
      end

      test "assigns rule_N id when no id present" do
        rules = [%{"condition" => nil, "actions" => []}]
        %{evaluated: [result]} = eval(rules, %{})
        assert result.rule_id == "rule_1"
      end
    end
  end
  ```
  Run: `mix test test/wpl/enforce/rule_evaluator_test.exs` — expect FAIL.

- [ ] Create `lib/wpl/enforce/rule_evaluator.ex`:
  ```elixir
  defmodule WPL.Enforce.RuleEvaluator do
    @moduledoc """
    Evaluates WPL personalization rules against a ClientContext.

    Ported from wpl-validator-ts/src/enforce/rule-evaluator.ts.
    Fail-closed: unknown condition field → UNKNOWN_CONDITION_FIELD diagnostic
    (rule evaluates to not-met). Action without string type → UNKNOWN_ACTION_TYPE
    diagnostic.

    ClientContext is a plain map with atom or string keys. Recognized fields:
    weight_kg, height_cm, age, sex, experience, injuries, equipment, fatigue,
    goals, cycle_day, cycle.
    """

    @known_fields MapSet.new([
      "weight", "weight_kg", "height", "height_cm", "age", "sex", "gender",
      "experience", "fitness_level", "injuries", "contraindications",
      "equipment", "fatigue", "goals", "cycle_day", "cycle_present"
    ])

    @type rule :: map()
    @type client_context :: map()
    @type evaluated_rule :: %{
            rule_id: String.t(),
            condition_met: boolean(),
            actions: [map()],
            condition: map() | nil
          }
    @type diagnostic :: %{
            code: String.t(),
            rule_id: String.t(),
            message: String.t(),
            meta: map()
          }

    @spec evaluate_rules([rule()], client_context()) ::
            %{evaluated: [evaluated_rule()], diagnostics: [diagnostic()]}
    def evaluate_rules(rules, ctx) when is_list(rules) do
      diagnostics = []

      {evaluated, diagnostics} =
        rules
        |> Enum.with_index(1)
        |> Enum.reduce({[], diagnostics}, fn {rule, idx}, {acc_evaluated, acc_diags} ->
          rule_id = Map.get(rule, "id") || Map.get(rule, :id) || "rule_#{idx}"
          condition = Map.get(rule, "condition") || Map.get(rule, :condition)

          {unknown_diags, condition_met} = evaluate_condition(rule_id, condition, ctx)

          actions_raw =
            Map.get(rule, "actions") || Map.get(rule, :actions) || []

          {actions, action_diags} = evaluate_actions(rule_id, actions_raw)

          entry = %{
            rule_id: rule_id,
            condition_met: condition_met,
            actions: actions,
            condition: condition
          }

          {[entry | acc_evaluated], acc_diags ++ unknown_diags ++ action_diags}
        end)

      %{evaluated: Enum.reverse(evaluated), diagnostics: diagnostics}
    end

    def evaluate_rules(_rules, ctx), do: evaluate_rules([], ctx)

    # Returns {diagnostics, condition_met}
    defp evaluate_condition(rule_id, condition, ctx) do
      unknown_fields = collect_unknown_fields(condition, rule_id)
      met = if unknown_fields == [], do: condition_met?(condition, ctx), else: false
      {unknown_fields, met}
    end

    defp collect_unknown_fields(nil, _rule_id), do: []
    defp collect_unknown_fields(condition, rule_id) when is_map(condition) do
      if compound?(condition) do
        inner = Map.get(condition, "conditions") || Map.get(condition, :conditions) || []
        Enum.flat_map(inner, &collect_unknown_fields(&1, rule_id))
      else
        field = Map.get(condition, "field") || Map.get(condition, :field)
        if is_binary(field) and not MapSet.member?(@known_fields, field) do
          [%{
            code: "UNKNOWN_CONDITION_FIELD",
            rule_id: rule_id,
            message: "condition references field '#{field}' which the enforcement engine cannot resolve — this rule can never fire",
            meta: %{field: field}
          }]
        else
          []
        end
      end
    end
    defp collect_unknown_fields(_condition, _rule_id), do: []

    defp condition_met?(nil, _ctx), do: true
    defp condition_met?(condition, ctx) when is_map(condition) do
      if compound?(condition) do
        compound_match(condition, ctx)
      else
        simple_match(condition, ctx)
      end
    end
    defp condition_met?(_condition, _ctx), do: false

    defp compound?(c) do
      Map.has_key?(c, "operator") or Map.has_key?(c, :operator) or
        Map.has_key?(c, "conditions") or Map.has_key?(c, :conditions)
    end

    defp compound_match(c, ctx) do
      op = Map.get(c, "operator") || Map.get(c, :operator) || "and"
      conditions = Map.get(c, "conditions") || Map.get(c, :conditions) || []

      if op == "or" do
        Enum.any?(conditions, &condition_met?(&1, ctx))
      else
        Enum.all?(conditions, &condition_met?(&1, ctx))
      end
    end

    defp simple_match(c, ctx) do
      op = Map.get(c, "op") || Map.get(c, :op) || "eq"
      field = Map.get(c, "field") || Map.get(c, :field)
      value = Map.get(c, "value") || Map.get(c, :value)
      actual = field_value(field, ctx)
      compare(actual, op, value)
    end

    defp compare(nil, _op, _value), do: false
    defp compare(actual, op, value) do
      case op do
        "eq" -> stringify(actual) == stringify(value)
        "neq" -> stringify(actual) != stringify(value)
        "gt" -> is_number(actual) and is_number(value) and actual > value
        "gte" -> is_number(actual) and is_number(value) and actual >= value
        "lt" -> is_number(actual) and is_number(value) and actual < value
        "lte" -> is_number(actual) and is_number(value) and actual <= value
        "contains" ->
          cond do
            is_list(actual) -> Enum.any?(actual, &(stringify(&1) == stringify(value)))
            is_binary(actual) -> String.contains?(actual, stringify(value) || "")
            true -> false
          end
        "not_contains" ->
          cond do
            is_list(actual) -> not Enum.any?(actual, &(stringify(&1) == stringify(value)))
            is_binary(actual) -> not String.contains?(actual, stringify(value) || "")
            true -> false
          end
        "in" ->
          is_list(value) and
            Enum.any?(value, &(stringify(&1) == stringify(actual)))
        "not_in" ->
          is_list(value) and
            not Enum.any?(value, &(stringify(&1) == stringify(actual)))
        _ -> false
      end
    end

    defp stringify(nil), do: ""
    defp stringify(v) when is_binary(v), do: v
    defp stringify(v) when is_number(v), do: to_string(v)
    defp stringify(v) when is_boolean(v), do: to_string(v)
    defp stringify(v) when is_atom(v), do: Atom.to_string(v)
    defp stringify(v), do: to_string(v)

    # Field resolution — mirrors the KNOWN_FIELDS set above exactly.
    defp field_value(field, ctx) do
      case field do
        f when f in ["weight", "weight_kg"] ->
          ctx[:weight_kg] || Map.get(ctx, "weight_kg")
        f when f in ["height", "height_cm"] ->
          ctx[:height_cm] || Map.get(ctx, "height_cm")
        "age" ->
          ctx[:age] || Map.get(ctx, "age")
        f when f in ["sex", "gender"] ->
          ctx[:sex] || Map.get(ctx, "sex")
        f when f in ["experience", "fitness_level"] ->
          ctx[:experience] || Map.get(ctx, "experience")
        f when f in ["injuries", "contraindications"] ->
          ctx[:injuries] || Map.get(ctx, "injuries")
        "equipment" ->
          ctx[:equipment] || Map.get(ctx, "equipment")
        "fatigue" ->
          ctx[:fatigue] || Map.get(ctx, "fatigue")
        "goals" ->
          ctx[:goals] || Map.get(ctx, "goals")
        "cycle_day" ->
          ctx[:cycle_day] || Map.get(ctx, "cycle_day")
        "cycle_present" ->
          cycle = ctx[:cycle] || Map.get(ctx, "cycle")
          if cycle, do: true, else: nil
        _ ->
          nil
      end
    end

    defp evaluate_actions(rule_id, actions) when is_list(actions) do
      Enum.reduce(actions, {[], []}, fn action, {acc_actions, acc_diags} ->
        type = action["type"] || action[:type]

        if is_binary(type) do
          {[normalize_action(action) | acc_actions], acc_diags}
        else
          diag = %{
            code: "UNKNOWN_ACTION_TYPE",
            rule_id: rule_id,
            message: "action has no string `type`; it cannot be applied and is ignored",
            meta: %{action: action}
          }
          {acc_actions, [diag | acc_diags]}
        end
      end)
      |> then(fn {actions, diags} -> {Enum.reverse(actions), Enum.reverse(diags)} end)
    end
    defp evaluate_actions(_rule_id, _actions), do: {[], []}

    defp normalize_action(action) when is_map(action) do
      action
      |> Enum.map(fn
        {k, v} when is_atom(k) -> {Atom.to_string(k), v}
        kv -> kv
      end)
      |> Map.new()
    end

    @doc "Return only the actions from rules whose condition was met."
    @spec firing_actions([evaluated_rule()]) :: [map()]
    def firing_actions(evaluated) do
      Enum.flat_map(evaluated, fn r ->
        if r.condition_met, do: r.actions, else: []
      end)
    end
  end
  ```

- [ ] Run: `mix test test/wpl/enforce/rule_evaluator_test.exs` — expect PASS.

#### V4c — `WPL.Enforce.Cycle`

- [ ] Write `test/wpl/enforce/cycle_test.exs` (failing):
  ```elixir
  defmodule WPL.Enforce.CycleTest do
    use ExUnit.Case, async: true

    alias WPL.Enforce.Cycle

    describe "compute_cycle_day/2" do
      test "same day as last_period_start is cycle day 1" do
        cycle = %{
          last_period_start: "2026-01-05",
          length_days: 28,
          pattern: "regular"
        }
        assert Cycle.compute_cycle_day("2026-01-05", cycle) == 1
      end

      test "one day after start is cycle day 2" do
        cycle = %{last_period_start: "2026-01-05", length_days: 28, pattern: "regular"}
        assert Cycle.compute_cycle_day("2026-01-06", cycle) == 2
      end

      test "wraps around at cycle length" do
        cycle = %{last_period_start: "2026-01-05", length_days: 28, pattern: "regular"}
        # day 28 from start = cycle day 1 of next cycle
        assert Cycle.compute_cycle_day("2026-02-02", cycle) == 1
      end

      test "returns nil for irregular cycle" do
        cycle = %{last_period_start: "2026-01-05", length_days: 28, pattern: "irregular"}
        assert Cycle.compute_cycle_day("2026-01-06", cycle) == nil
      end

      test "returns nil for suppressed cycle" do
        cycle = %{last_period_start: "2026-01-05", length_days: 28, pattern: "suppressed"}
        assert Cycle.compute_cycle_day("2026-01-06", cycle) == nil
      end

      test "returns nil when last_period_start is nil" do
        cycle = %{length_days: 28, pattern: "regular"}
        assert Cycle.compute_cycle_day("2026-01-06", cycle) == nil
      end
    end

    describe "day_date_for_plan_position/4" do
      test "week 1 day 0 offset from Monday plan start is the same date" do
        # planStart 2026-01-05 (Monday), weeksBeforePhase=0, weekInPhase=1, dayOffset=0
        assert Cycle.day_date_for_plan_position("2026-01-05", 0, 1, 0) == "2026-01-05"
      end

      test "week 1 day 1 is Tuesday" do
        assert Cycle.day_date_for_plan_position("2026-01-05", 0, 1, 1) == "2026-01-06"
      end

      test "week 2 day 0 is 7 days after plan start" do
        assert Cycle.day_date_for_plan_position("2026-01-05", 0, 2, 0) == "2026-01-12"
      end
    end

    describe "day_of_week_offset/1" do
      test "monday -> 0" do
        assert Cycle.day_of_week_offset("monday") == 0
      end

      test "case-insensitive" do
        assert Cycle.day_of_week_offset("Monday") == 0
      end

      test "integer 1 (Monday convention) -> 0" do
        assert Cycle.day_of_week_offset(1) == 0
      end

      test "integer 7 -> 6" do
        assert Cycle.day_of_week_offset(7) == 6
      end

      test "nil -> nil" do
        assert Cycle.day_of_week_offset(nil) == nil
      end

      test "REST -> nil" do
        assert Cycle.day_of_week_offset("REST") == nil
      end
    end
  end
  ```
  Run: `mix test test/wpl/enforce/cycle_test.exs` — expect FAIL.

- [ ] Create `lib/wpl/enforce/cycle.ex`:
  ```elixir
  defmodule WPL.Enforce.Cycle do
    @moduledoc """
    Cycle-aware date arithmetic for the Pass-3 enforcement engine.

    Ported from wpl-validator-ts/src/enforce/cycle.ts. Pure functions, no I/O.
    All dates are ISO-8601 strings ("YYYY-MM-DD") treated as UTC midnight.
    """

    @type cycle :: %{
            optional(:last_period_start) => String.t() | nil,
            optional(:length_days) => pos_integer() | nil,
            optional(:pattern) => String.t() | nil
          }

    @day_of_week_map %{
      "monday" => 0, "tuesday" => 1, "wednesday" => 2, "thursday" => 3,
      "friday" => 4, "saturday" => 5, "sunday" => 6
    }

    @doc "Map a WPL day_of_week token to a 0-based offset from Monday. Returns nil for non-weekday tokens."
    @spec day_of_week_offset(String.t() | integer() | nil) :: 0..6 | nil
    def day_of_week_offset(token) when is_integer(token) do
      if token >= 1 and token <= 7, do: rem(token - 1, 7), else: nil
    end
    def day_of_week_offset(nil), do: nil
    def day_of_week_offset(token) when is_binary(token) do
      Map.get(@day_of_week_map, String.downcase(token))
    end
    def day_of_week_offset(_), do: nil

    @doc """
    Compute the 1-indexed cycle_day at `date` given the client's cycle anchor.
    Returns nil when the cycle is not projectable (irregular or suppressed).
    """
    @spec compute_cycle_day(String.t(), cycle()) :: pos_integer() | nil
    def compute_cycle_day(date, cycle) do
      if projectable?(cycle) do
        d = parse_iso_date(date)
        anchor = parse_iso_date(Map.get(cycle, :last_period_start) || Map.get(cycle, "last_period_start"))
        len = Map.get(cycle, :length_days) || Map.get(cycle, "length_days")
        delta = Date.diff(d, anchor)
        mod = rem(rem(delta, len) + len, len)
        mod + 1
      else
        nil
      end
    end

    @doc """
    Compute the calendar date of a plan day given its structural position.
    `day_offset_in_week` is 0-based from Monday (0=Mon, 6=Sun).
    """
    @spec day_date_for_plan_position(String.t(), non_neg_integer(), pos_integer(), 0..6) :: String.t()
    def day_date_for_plan_position(plan_start, weeks_before_phase, week_in_phase, day_offset_in_week) do
      start = parse_iso_date(plan_start)
      total_day_offset = (weeks_before_phase + (week_in_phase - 1)) * 7 + day_offset_in_week
      start
      |> Date.add(total_day_offset)
      |> Date.to_iso8601()
    end

    defp projectable?(cycle) do
      pattern = Map.get(cycle, :pattern) || Map.get(cycle, "pattern")
      lps = Map.get(cycle, :last_period_start) || Map.get(cycle, "last_period_start")
      len = Map.get(cycle, :length_days) || Map.get(cycle, "length_days")

      pattern not in ["suppressed", "irregular"] and
        is_binary(lps) and
        is_integer(len) and len > 0
    end

    defp parse_iso_date(s) when is_binary(s) do
      case Date.from_iso8601(s) do
        {:ok, date} -> date
        _ -> raise ArgumentError, "cycle: invalid ISO date \"#{s}\""
      end
    end
  end
  ```

- [ ] Run: `mix test test/wpl/enforce/cycle_test.exs` — expect PASS.

#### V4d — `WPL.Enforce` (the main engine)

- [ ] Write `test/wpl/enforce_test.exs` (failing):
  ```elixir
  defmodule WPL.EnforceTest do
    use ExUnit.Case, async: true

    alias WPL.Enforce

    # Minimal plan with one exercise activity in one block
    defp plan_with(exercise_refs) do
      activities = Enum.map(exercise_refs, fn ref ->
        %{"type" => "exercise", "exercise_ref" => ref}
      end)
      %{
        "plan" => %{
          "phases" => [%{
            "weeks" => [%{
              "order" => 1,
              "days" => [%{
                "day_of_week" => 1,
                "blocks" => [%{"type" => "main", "activities" => activities}]
              }]
            }]
          }]
        }
      }
    end

    defp forbid_rule(id, injury, exercise) do
      %{
        "id" => id,
        "condition" => %{"field" => "injuries", "op" => "contains", "value" => injury},
        "actions" => [%{"type" => "forbid_exercise", "exercise" => exercise}]
      }
    end

    describe "enforce/4" do
      test "strips forbidden exercise and reports it in stripped list" do
        plan = plan_with(["pistol_squat", "bench_press"])
        ctx = %{injuries: ["torn_meniscus"]}
        rules = [forbid_rule("forbid_pistol", "torn_meniscus", "pistol_squat")]

        result = Enforce.enforce(plan, ctx, rules)

        refuted_exercises = Enum.map(result.stripped, & &1.exercise)
        assert "pistol_squat" in refuted_exercises

        # bench_press must survive
        surviving =
          result.plan
          |> get_in(["plan", "phases", Access.at(0), "weeks", Access.at(0),
                     "days", Access.at(0), "blocks", Access.at(0), "activities"])
        assert Enum.any?(surviving, &(&1["exercise_ref"] == "bench_press"))
        refute Enum.any?(surviving, &(&1["exercise_ref"] == "pistol_squat"))
      end

      test "condition not met — exercise survives" do
        plan = plan_with(["pistol_squat"])
        ctx = %{injuries: []}
        rules = [forbid_rule("forbid_pistol", "torn_meniscus", "pistol_squat")]

        result = Enforce.enforce(plan, ctx, rules)

        assert result.stripped == []
        surviving =
          result.plan
          |> get_in(["plan", "phases", Access.at(0), "weeks", Access.at(0),
                     "days", Access.at(0), "blocks", Access.at(0), "activities"])
        assert Enum.any?(surviving, &(&1["exercise_ref"] == "pistol_squat"))
      end

      test "fuzzy name match strips exercise" do
        plan = %{
          "plan" => %{
            "phases" => [%{
              "weeks" => [%{
                "order" => 1,
                "days" => [%{
                  "day_of_week" => 1,
                  "blocks" => [%{"type" => "main", "activities" => [
                    %{"type" => "exercise", "name" => "Bulgarian Split Squats"}
                  ]}]
                }]
              }]
            }]
          }
        }
        ctx = %{injuries: ["knee_instability"]}
        rules = [%{
          "id" => "forbid_bulgarian",
          "condition" => %{"field" => "injuries", "op" => "contains", "value" => "knee_instability"},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "bulgarian_split_squat_below_parallel"}]
        }]

        result = Enforce.enforce(plan, ctx, rules)
        assert length(result.stripped) == 1
        assert hd(result.stripped).exercise == "Bulgarian Split Squats"
      end

      test "unknown condition field emits diagnostic and exercise is NOT stripped" do
        plan = plan_with(["pistol_squat"])
        ctx = %{injuries: ["torn_meniscus"]}
        rules = [%{
          "id" => "bad_rule",
          "condition" => %{"field" => "injures", "op" => "contains", "value" => "torn_meniscus"},
          "actions" => [%{"type" => "forbid_exercise", "exercise" => "pistol_squat"}]
        }]

        result = Enforce.enforce(plan, ctx, rules)
        assert result.stripped == []
        assert Enum.any?(result.diagnostics, &(&1.code == "UNKNOWN_CONDITION_FIELD"))
      end

      test "plan without plan key returns early with no stripped" do
        result = Enforce.enforce(%{}, %{}, [])
        assert result.stripped == []
      end
    end
  end
  ```
  Run: `mix test test/wpl/enforce_test.exs` — expect FAIL.

- [ ] Create `lib/wpl/enforce.ex`:
  ```elixir
  defmodule WPL.Enforce do
    @moduledoc """
    Pass-3 enforcement: evaluate personalization rules against a ClientContext
    and strip forbidden activities from a compiled WPL plan.

    Ported from wpl-validator-ts/src/enforce/index.ts. Pure function, no
    process state. Maps are immutable in Elixir so "deep clone" is structural
    copy via `Jason.decode!(Jason.encode!(plan_json))` for round-trip purity,
    matching the TS `JSON.parse(JSON.stringify(...))` behavior.
    """

    alias WPL.Enforce.{Cycle, Matcher, RuleEvaluator}

    @applicable_actions MapSet.new(["forbid_exercise"])

    @type client_context :: map()
    @type rule :: map()
    @type enforce_opts :: [plan_start_date: String.t()]
    @type enforcement_result :: %{
            plan: map(),
            evaluated_rules: [map()],
            stripped: [map()],
            diagnostics: [map()]
          }

    @doc """
    Evaluate `rules` against `ctx` and strip forbidden activities from `plan_json`.

    Returns `%{plan, evaluated_rules, stripped, diagnostics}`.

    Options:
    - `:plan_start_date` — ISO date string of plan day 1 (required for cycle_day-conditioned rules).
    """
    @spec enforce(map(), client_context(), [rule()], enforce_opts()) :: enforcement_result()
    def enforce(plan_json, ctx, rules, opts \\ []) do
      diagnostics = []
      stripped = []

      static_eval = RuleEvaluator.evaluate_rules(rules, ctx)
      diagnostics = diagnostics ++ static_eval.diagnostics

      # Emit diagnostics for non-applicable action types
      non_applicable_diags =
        Enum.flat_map(static_eval.evaluated, fn r ->
          Enum.flat_map(r.actions, fn a ->
            if not MapSet.member?(@applicable_actions, a["type"] || a[:type] || "") do
              [%{
                code: "UNKNOWN_ACTION_TYPE",
                rule_id: r.rule_id,
                message: "action type '#{a["type"] || a[:type]}' has no enforcement applicator yet — it is reported but not applied",
                meta: %{action_type: a["type"] || a[:type]}
              }]
            else
              []
            end
          end)
        end)
      diagnostics = diagnostics ++ non_applicable_diags

      static_forbids = forbidden_exercises(tag_actions(static_eval.evaluated))

      # Deep clone via JSON round-trip (matches TS JSON.parse/JSON.stringify)
      clone = plan_json |> Jason.encode!() |> Jason.decode!()
      inner_plan = Map.get(clone, "plan")

      if not is_map(inner_plan) do
        %{plan: clone, evaluated_rules: static_eval.evaluated, stripped: stripped, diagnostics: diagnostics}
      else
        plan_start_date = Keyword.get(opts, :plan_start_date)
        uses_cycle = not is_nil(ctx[:cycle] || Map.get(ctx, "cycle")) and not is_nil(plan_start_date)

        {new_plan, stripped, diagnostics} =
          walk_phases(inner_plan, ctx, rules, static_forbids, uses_cycle, plan_start_date, stripped, diagnostics)

        final_clone = Map.put(clone, "plan", new_plan)
        %{
          plan: final_clone,
          evaluated_rules: static_eval.evaluated,
          stripped: stripped,
          diagnostics: diagnostics
        }
      end
    end

    defp tag_actions(evaluated) do
      Enum.flat_map(evaluated, fn r ->
        if r.condition_met do
          Enum.map(r.actions, fn a -> Map.put(a, "__rule_id", r.rule_id) end)
        else
          []
        end
      end)
    end

    defp forbidden_exercises(actions) do
      Enum.reduce(actions, %{}, fn a, acc ->
        type = a["type"] || a[:type]
        exercise = a["exercise"] || a[:exercise]
        rule_id = a["__rule_id"] || "unknown_rule"

        if type == "forbid_exercise" and is_binary(exercise) and not Map.has_key?(acc, exercise) do
          Map.put(acc, exercise, rule_id)
        else
          acc
        end
      end)
    end

    defp activity_name(act) do
      cond do
        is_binary(act["exercise_ref"]) -> act["exercise_ref"]
        is_binary(act["name"]) -> act["name"]
        true -> ""
      end
    end

    defp match_forbid(name, forbids) do
      if name == "" do
        nil
      else
        Enum.find_value(forbids, fn {pattern, rule_id} ->
          if Matcher.collides(name, pattern), do: rule_id, else: nil
        end)
      end
    end

    defp walk_phases(inner_plan, ctx, rules, static_forbids, uses_cycle, plan_start_date, stripped, diagnostics) do
      phases = inner_plan["phases"] || []

      {new_phases, stripped, diagnostics, _weeks_before} =
        phases
        |> Enum.with_index()
        |> Enum.reduce({[], stripped, diagnostics, 0}, fn {phase, _pi}, {acc_phases, acc_stripped, acc_diags, weeks_before} ->
          weeks = phase["weeks"] || []

          {new_weeks, acc_stripped, acc_diags} =
            weeks
            |> Enum.with_index()
            |> Enum.reduce({[], acc_stripped, acc_diags}, fn {week, wi}, {acc_weeks, acc_s, acc_d} ->
              week_order = if is_number(week["order"]), do: trunc(week["order"]), else: wi + 1
              days = week["days"] || []

              {new_days, acc_s, acc_d} =
                days
                |> Enum.with_index()
                |> Enum.reduce({[], acc_s, acc_d}, fn {day, di}, {acc_days, s, d} ->
                  forbids =
                    if uses_cycle or false do
                      dow = Cycle.day_of_week_offset(day["day_of_week"])
                      if not is_nil(dow) and not is_nil(plan_start_date) do
                        date = Cycle.day_date_for_plan_position(plan_start_date, weeks_before, week_order, dow)
                        cycle = ctx[:cycle] || Map.get(ctx, "cycle")
                        if uses_cycle and is_map(cycle) do
                          cd = Cycle.compute_cycle_day(date, cycle)
                          day_eval = RuleEvaluator.evaluate_rules(rules, Map.put(ctx, :cycle_day, cd))
                          day_forbids = forbidden_exercises(tag_actions(day_eval.evaluated))
                          Map.merge(static_forbids, day_forbids)
                        else
                          static_forbids
                        end
                      else
                        static_forbids
                      end
                    else
                      static_forbids
                    end

                  if map_size(forbids) == 0 do
                    {[day | acc_days], s, d}
                  else
                    blocks = day["blocks"] || []

                    {new_blocks, s, d} =
                      blocks
                      |> Enum.with_index()
                      |> Enum.reduce({[], s, d}, fn {block, bi}, {acc_blocks, bs, bd} ->
                        activities = block["activities"] || []

                        {kept, bs, bd} =
                          activities
                          |> Enum.with_index()
                          |> Enum.reduce({[], bs, bd}, fn {act, ai}, {k, ks, kd} ->
                            name = activity_name(act)
                            matched_rule = match_forbid(name, forbids)

                            if is_nil(matched_rule) do
                              {[act | k], ks, kd}
                            else
                              phase_idx = _pi = length(acc_phases)
                              week_idx = wi
                              day_idx = di
                              block_idx = bi
                              act_idx = ai
                              path = "/plan/phases/#{phase_idx}/weeks/#{week_idx}/days/#{day_idx}/blocks/#{block_idx}/activities/#{act_idx}"
                              entry = %{exercise: name, matched_rule: matched_rule, path: path}
                              {k, [entry | ks], kd}
                            end
                          end)

                        new_block = Map.put(block, "activities", Enum.reverse(kept))
                        {[new_block | acc_blocks], bs, bd}
                      end)

                    new_day = Map.put(day, "blocks", Enum.reverse(new_blocks))
                    {[new_day | acc_days], bs, bd}
                  end
                end)

              new_week = Map.put(week, "days", Enum.reverse(new_days))
              {[new_week | acc_weeks], acc_s, acc_d}
            end)

          new_phase = Map.put(phase, "weeks", Enum.reverse(new_weeks))
          {[new_phase | acc_phases], acc_stripped, acc_diags, weeks_before + length(weeks)}
        end)

      new_inner = Map.put(inner_plan, "phases", Enum.reverse(new_phases))
      {new_inner, Enum.reverse(stripped), diagnostics}
    end
  end
  ```

  > **Implementation note**: the nested phase index (`_pi`) inside `walk_phases` is tracked via `length(acc_phases)` because we're building the output list in reverse. This matches the TS source's `pi` variable from the outer loop — the path reported in `stripped` entries is the original 0-based index from the input, not the output accumulator position. Verify with the conformance tests in V5.

- [ ] Run: `mix test test/wpl/enforce_test.exs` — expect PASS. Fix any path-index drift by logging and comparing against the fixture expectations.

- [ ] Run quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "feat: port Pass-3 enforcement engine as WPL.Enforce (matcher, rule_evaluator, cycle)"
  ```

---

### V5 — Enforcement conformance fixtures and runner

**Purpose:** Copy the 6 JSON fixtures from the TS repo into `priv/conformance/enforcement/` and write an ExUnit runner that drives `WPL.Enforce.enforce/4` against each. These are the cross-language contract.

**Files:**
- `priv/conformance/enforcement/forbid-static.json` (copy from TS repo)
- `priv/conformance/enforcement/forbid-fuzzy-name.json`
- `priv/conformance/enforcement/forbid-condition-not-met.json`
- `priv/conformance/enforcement/forbid-unknown-field-diagnostic.json`
- `priv/conformance/enforcement/forbid-cycle-window.json`
- `priv/conformance/enforcement/forbid-fuzzy-plural.json`
- `test/wpl/enforce/conformance_test.exs`

**Steps:**

- [ ] Copy fixtures:
  ```bash
  mkdir -p /Users/alex/Projects/my/gymbile.com/wpl-validator-ex/priv/conformance/enforcement
  for f in forbid-static forbid-fuzzy-name forbid-condition-not-met \
            forbid-unknown-field-diagnostic forbid-cycle-window forbid-fuzzy-plural; do
    cp /Users/alex/Projects/my/gymbile.com/wpl-validator-ts/conformance/enforcement/${f}.json \
       /Users/alex/Projects/my/gymbile.com/wpl-validator-ex/priv/conformance/enforcement/${f}.json
  done
  ```

- [ ] Write `test/wpl/enforce/conformance_test.exs` (failing until fixtures are copied):
  ```elixir
  defmodule WPL.Enforce.ConformanceTest do
    use ExUnit.Case, async: false

    alias WPL.Enforce

    @enforcement_dir Application.app_dir(:wpl_validator, "priv/conformance/enforcement")

    # Each fixture JSON has:
    #   "plan"    — the compiled WPL JSON
    #   "context" — ClientContext (string-keyed; we convert to atom-keyed)
    #   "rules"   — list of personalization rules
    #   "options" — { "planStartDate"?: string }
    #   "expect"  — { "stripped_exercises": [...], "surviving_refs": [...], "diagnostic_codes": [...] }

    describe "enforcement conformance fixtures" do
      for path <- Path.wildcard(Path.join(@enforcement_dir, "*.json")) do
        @path path
        test Path.basename(@path, ".json") do
          fixture = @path |> File.read!() |> Jason.decode!()

          plan = fixture["plan"]
          ctx = atomize_context(fixture["context"] || %{})
          rules = fixture["rules"] || []
          opts = build_opts(fixture["options"] || %{})
          expect = fixture["expect"]

          result = Enforce.enforce(plan, ctx, rules, opts)

          # stripped_exercises: every exercise listed must appear in result.stripped
          stripped_names = Enum.map(result.stripped, & &1.exercise)
          for ex <- expect["stripped_exercises"] || [] do
            assert ex in stripped_names,
                   "Expected '#{ex}' to be stripped, but stripped was: #{inspect(stripped_names)}"
          end

          # No extra strips beyond what is expected
          assert length(result.stripped) == length(expect["stripped_exercises"] || []),
                 "Expected #{length(expect["stripped_exercises"] || [])} stripped, got #{length(result.stripped)}: #{inspect(stripped_names)}"

          # surviving_refs: these exercise_refs must appear in the output plan
          all_activity_refs = collect_all_refs(result.plan)
          for ref <- expect["surviving_refs"] || [] do
            assert ref in all_activity_refs,
                   "Expected '#{ref}' to survive, but activities were: #{inspect(all_activity_refs)}"
          end

          # diagnostic_codes: expected codes must appear in diagnostics
          diag_codes = Enum.map(result.diagnostics, & &1.code)
          for code <- expect["diagnostic_codes"] || [] do
            assert code in diag_codes,
                   "Expected diagnostic '#{code}', got: #{inspect(diag_codes)}"
          end
        end
      end
    end

    # Convert string-keyed context map to atom-keyed, and handle nested cycle map.
    defp atomize_context(ctx) when is_map(ctx) do
      ctx
      |> Enum.map(fn
        {"cycle", v} when is_map(v) -> {:cycle, atomize_context(v)}
        {k, v} -> {String.to_atom(k), v}
      end)
      |> Map.new()
    end

    defp build_opts(options) when is_map(options) do
      case Map.get(options, "planStartDate") do
        nil -> []
        date -> [plan_start_date: date]
      end
    end

    # Walk the output plan and collect all exercise_ref and name strings.
    defp collect_all_refs(plan) when is_map(plan) do
      (plan["plan"]["phases"] || [])
      |> Enum.flat_map(fn phase ->
        (phase["weeks"] || [])
        |> Enum.flat_map(fn week ->
          (week["days"] || [])
          |> Enum.flat_map(fn day ->
            (day["blocks"] || [])
            |> Enum.flat_map(fn block ->
              (block["activities"] || [])
              |> Enum.flat_map(fn act ->
                [act["exercise_ref"], act["name"]]
                |> Enum.filter(&is_binary/1)
              end)
            end)
          end)
        end)
      end)
    end
  end
  ```

- [ ] Run: `mix test test/wpl/enforce/conformance_test.exs` — expect some FAIL (the path index tracking issue from V4d will show up here for the stripped path). Fix `WPL.Enforce.walk_phases/8` path indices if needed by tracing with the fixture outputs.

- [ ] Run full test suite:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "test: add enforcement conformance fixtures and runner"
  ```

---

### V6 — Release prep: version 1.8.0 + CHANGELOG

**Files:**
- `mix.exs`
- `CHANGELOG.md`
- `priv/schema-version.txt` (already done in V1)

**Steps:**

- [ ] Update `mix.exs`: change `@version "1.7.1"` to `@version "1.8.0"`.

- [ ] Update `CHANGELOG.md`: add a `[1.8.0]` entry at the top (after `[Unreleased]`), following the existing Keep a Changelog style observed in the file:
  ```markdown
  ## [1.8.0] — 2026-06-17

  ### Added
  - **Pass-3 enforcement engine**: `WPL.Enforce.enforce/3,4` evaluates personalization
    rules against a `ClientContext` and strips forbidden activities from a compiled plan.
    Exports: `WPL.Enforce`, `WPL.Enforce.Matcher`, `WPL.Enforce.RuleEvaluator`,
    `WPL.Enforce.Cycle`. Fail-closed diagnostics: `UNKNOWN_CONDITION_FIELD`,
    `UNKNOWN_ACTION_TYPE`.
  - Enforcement conformance fixtures (`priv/conformance/enforcement/`) — 6 cross-language
    fixtures shared with `@gymbile/wpl-validator@1.8.0`.
  - `forbid_exercise` accepted by `WPL.Validator.Rules.InvalidPersonalizationRule`.
  - `in` / `not_in` condition ops tested (already pass; schema sync completes support).
  - Strict catalog mode: `validate(plan, require_catalog: true)` emits `:catalog_required`
    instead of silently skipping entity resolution when no catalog is supplied.
  - `:catalog_required` added to `WPL.Validator.Error.@type code`.

  ### Changed
  - Catalog ref resolution is now case-insensitive (lowercases both ref and catalog entries
    before comparing). Mirrors `@gymbile/wpl-validator@1.8.0` `hasRef` behavior.
  - Vendored schema updated to WPL v1.7.0.
  ```

- [ ] Run final quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```
  All tests must pass.

- [ ] Commit:
  ```
  git commit -m "chore: release 1.8.0"
  ```

---

## wpl-ai-ex Tasks

Repo root: `/Users/alex/Projects/my/gymbile.com/wpl-ai-ex`

> **Prerequisite**: `wpl_validator ~> 1.8` must be available either on Hex or as a local path dep. Since 1.8.0 is not yet published, the safety-invariant test (A4) must use a path dep during development:
> ```elixir
> {:wpl_validator, path: "../wpl-validator-ex", only: :test}
> ```
> This is explicitly called out in Task A4.

---

### A1 — `repairs[]` ledger: `WplAi.CompileResult` and repairs accumulator

**Envelope shape decision:** Use `{:ok, json, repairs}` as a 3-tuple return from `WplAi.to_wpl/1`, **not** a `%CompileResult{}` struct. Rationale: a struct would require all callers to destructure differently; a tagged 3-tuple is idiomatic in Elixir for "success with side-channel data" and mirrors how `{:ok, value}` is extended without breaking existing `with {:ok, json} <-` pipelines if callers pattern-match on the first two elements. Existing callers using `{:ok, json} = WplAi.to_wpl(src)` will receive a `MatchError` at runtime — this is correct (BREAKING: 2.0.0) and documented in the CHANGELOG. The function signature becomes:
```elixir
@spec to_wpl(String.t()) :: {:ok, map(), [repair()]} | {:error, list()}
```

A `repair()` is a plain map with at minimum a `:type` atom key and a `:message` string key plus optional repair-specific keys.

**Files:**
- `lib/wpl_ai.ex`
- `lib/wpl_ai/parser.ex`
- `test/wpl_ai_test.exs`
- `test/wpl_ai/parser_test.exs` (a section, not the whole file)

**Steps:**

- [ ] Write failing tests for the new signature. Add to `test/wpl_ai_test.exs`:
  ```elixir
  describe "to_wpl/1 — repairs ledger" do
    test "returns 3-tuple {ok, json, repairs} on success" do
      source = ~S"""
      PLAN "Repair Test"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      """
      assert {:ok, _json, repairs} = WplAi.to_wpl(source)
      assert is_list(repairs)
    end

    test "repairs list is empty for a plan with no silent normalizations" do
      source = ~S"""
      PLAN "Clean Plan"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      """
      {:ok, _json, repairs} = WplAi.to_wpl(source)
      # A minimal clean plan should have zero repairs
      assert repairs == []
    end

    test "unknown ALL-CAPS section (non-safety) records a skipped_section repair" do
      source = ~S"""
      PLAN "Plan With Notes"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      NOTES:
        Some extra prose.
      """
      {:ok, _json, repairs} = WplAi.to_wpl(source)
      assert Enum.any?(repairs, &(&1.type == :skipped_section))
    end
  end
  ```
  Run: `mix test test/wpl_ai_test.exs` — expect new tests to FAIL (current `to_wpl/1` returns 2-tuple).

- [ ] Add `:repairs` field to the parser state type in `lib/wpl_ai/parser.ex`. The `@type parse_state` at line 14 currently is:
  ```elixir
  @type parse_state :: %{
          tokens: [Lexer.token()],
          pos: non_neg_integer(),
          errors: [ParseError.t()]
        }
  ```
  Add `:repairs` field:
  ```elixir
  @type repair :: %{
          type: atom(),
          message: String.t()
        }

  @type parse_state :: %{
          tokens: [Lexer.token()],
          pos: non_neg_integer(),
          errors: [ParseError.t()],
          repairs: [repair()]
        }
  ```

- [ ] Update `parse_tokens/1` at line 41 to initialize `repairs: []` in the initial state map:
  ```elixir
  state = %{
    tokens: tokens,
    pos: 0,
    errors: [],
    repairs: []
  }
  ```

- [ ] Update `parse_tokens/1` to thread repairs out on success. Change the `{:ok, document, %{errors: []}}` branch:
  ```elixir
  case parse_document(state) do
    {:ok, document, %{errors: [], repairs: repairs}} ->
      {:ok, document, Enum.reverse(repairs)}

    {:ok, document, %{errors: []}} ->
      {:ok, document, []}

    {:ok, _document, %{errors: errors}} ->
      {:error, Enum.reverse(errors)}

    {:error, errors} ->
      {:error, errors}
  end
  ```

- [ ] Add a private `add_repair/2` helper in `lib/wpl_ai/parser.ex` (near the top of the private section):
  ```elixir
  defp add_repair(state, repair) when is_map(repair) do
    %{state | repairs: [repair | state.repairs]}
  end
  ```

- [ ] Record a `skipped_section` repair in the existing ALL-CAPS tolerant-skip branch of `parse_sections/2` (currently at lines 272–292). After the `if` guard and before `parse_sections(state, sections)`, add:
  ```elixir
  state = add_repair(state, %{
    type: :skipped_section,
    section: caps_kw,
    message: "Unknown top-level section \"#{caps_kw}\" skipped"
  })
  ```

- [ ] Update `WplAi.parse/1` and `WplAi.parse_tokens/1` in `lib/wpl_ai/parser.ex` to return the repairs on the success path. The public `parse/1` currently returns `{:ok, AST.Document.t()}`. Extend the internal path so `parse_tokens/1` becomes:
  ```elixir
  @spec parse_tokens([Lexer.token()]) :: {:ok, AST.Document.t(), [repair()]} | {:error, list()}
  ```
  Update `parse/1` to propagate:
  ```elixir
  @spec parse(String.t()) :: {:ok, AST.Document.t(), [repair()]} | {:error, list()}
  def parse(source) do
    case Lexer.tokenize(source) do
      {:ok, tokens} -> parse_tokens(tokens)
      {:error, lexer_errors} -> {:error, lexer_errors}
    end
  end
  ```

- [ ] Update `WplAi.to_wpl/1` in `lib/wpl_ai.ex` to return `{:ok, json, repairs}`:
  ```elixir
  @spec to_wpl(String.t()) :: {:ok, map(), [WplAi.Parser.repair()]} | {:error, list()}
  def to_wpl(source) when is_binary(source) do
    with {:ok, doc, repairs} <- parse(source),
         {:ok, json} <- compile(doc) do
      {:ok, json, repairs}
    end
  end
  ```

- [ ] Update `to_wpl!/1` similarly:
  ```elixir
  @spec to_wpl!(String.t()) :: map()
  def to_wpl!(source) when is_binary(source) do
    case to_wpl(source) do
      {:ok, json, _repairs} -> json
      {:error, errors} -> raise "WPL-AI parse error: #{Errors.format_errors(errors, source)}"
    end
  end
  ```

- [ ] Update `parse!/1` in `lib/wpl_ai.ex` (currently calls `parse/1` expecting a 2-tuple):
  ```elixir
  @spec parse!(String.t()) :: AST.Document.t()
  def parse!(source) when is_binary(source) do
    case parse(source) do
      {:ok, document, _repairs} -> document
      {:error, errors} -> raise "WPL-AI parse error: #{Errors.format_errors(errors, source)}"
    end
  end
  ```

- [ ] Update `validate/1` (which calls `parse/1` expecting `{:ok, _}`):
  ```elixir
  @spec validate(String.t()) :: :ok | {:error, list()}
  def validate(source) when is_binary(source) do
    case parse(source) do
      {:ok, _doc, _repairs} -> :ok
      {:error, errors} -> {:error, errors}
    end
  end
  ```

- [ ] Scan all other call sites of `WplAi.parse/1` and `WplAi.Parser.parse/1` in the test files (e.g. `test/wpl_ai/parser_test.exs`). The test helper `parse!/1` at line 13 uses:
  ```elixir
  defp parse!(source) do
    assert {:ok, doc} = Parser.parse(source)
    doc
  end
  ```
  Update to:
  ```elixir
  defp parse!(source) do
    assert {:ok, doc, _repairs} = Parser.parse(source)
    doc
  end
  ```
  Apply the same fix to any other test file calling `Parser.parse(...)` with a 2-tuple pattern. Run `grep -rn '{:ok, doc} = Parser.parse\|{:ok, doc} = WplAi.parse' test/` to find all occurrences.

- [ ] Run quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "feat: introduce repairs ledger; to_wpl/1 returns {:ok, json, repairs} (BREAKING)"
  ```

---

### A2 — Fail-closed safety sections + strict contraindications

**Purpose:** Port the two TS fail-closed behaviors from `wpl-ai/src/parser.ts`:
1. Safety-adjacent ALL-CAPS section names matching `~r/^(REQUIRE|CONTRA|SAFETY|PRECAUTION|MEDICAL|CLEARANCE)/` → hard `ParseError` (not a silent skip + repair).
2. Unknown contraindication `severity` and `action` → hard `ParseError` (not a silent `nil` or `:exclude` default).

**Files:**
- `lib/wpl_ai/parser.ex`
- `test/wpl_ai/parser_test.exs`

**Steps:**

- [ ] Write failing tests:
  ```elixir
  # In test/wpl_ai/parser_test.exs
  # Add a new describe block

  describe "parse/1 - fail-closed safety sections" do
    test "REQUIREMENTS: typo is a hard parse error, not a silent skip" do
      source = ~S"""
      PLAN "Bad Plan"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      REQUIREMENTS:
        contraindication knee_pain -> exclude
      """
      assert {:error, errors} = WplAi.Parser.parse(source)
      assert Enum.any?(errors, fn e ->
        message = if is_map(e), do: e.message || e[:message] || "", else: ""
        String.contains?(message, "REQUIREMENTS") or
          (is_struct(e) and String.contains?(to_string(e), "REQUIREMENTS"))
      end)
    end

    test "CONTRAINDICATIONS: typo is a hard parse error" do
      source = ~S"""
      PLAN "Bad Plan"
      TYPE workout
      CONTRAINDICATIONS:
        knee_pain -> exclude
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      """
      assert {:error, _errors} = WplAi.Parser.parse(source)
    end

    test "SAFETY_NOTES: is a hard parse error (safety-adjacent prefix)" do
      source = ~S"""
      PLAN "Bad Plan"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      SAFETY_NOTES:
        Some notes.
      """
      assert {:error, _errors} = WplAi.Parser.parse(source)
    end

    test "NOTES: (non-safety) is silently skipped with a repair" do
      source = ~S"""
      PLAN "Clean Plan"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      NOTES:
        Some prose.
      """
      assert {:ok, _doc, repairs} = WplAi.Parser.parse(source)
      assert Enum.any?(repairs, &(&1.type == :skipped_section))
    end
  end

  describe "parse/1 - strict contraindications" do
    test "unknown contraindication severity is a hard parse error" do
      source = ~S"""
      PLAN "Bad Plan"
      TYPE workout
      REQUIRES
        contraindication knee_pain severity extreme action exclude
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      """
      assert {:error, errors} = WplAi.Parser.parse(source)
      assert length(errors) >= 1
    end

    test "unknown contraindication action is a hard parse error" do
      source = ~S"""
      PLAN "Bad Plan"
      TYPE workout
      REQUIRES
        contraindication knee_pain action banish
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      """
      assert {:error, errors} = WplAi.Parser.parse(source)
      assert length(errors) >= 1
    end

    test "valid contraindication with known severity and action parses cleanly" do
      source = ~S"""
      PLAN "Good Plan"
      TYPE workout
      REQUIRES
        contraindication knee_pain severity high action modify
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "Day 1":
              main straight_sets:
                push_up 3x10
      """
      assert {:ok, doc, _repairs} = WplAi.Parser.parse(source)
      contra = doc.requirements.contraindications |> hd()
      assert contra.severity == :high
      assert contra.action == :modify
    end
  end
  ```
  Run: `mix test test/wpl_ai/parser_test.exs` — expect new tests to FAIL.

- [ ] Implement safety-section fail-closed logic in `parse_sections/2` (around line 273 in `lib/wpl_ai/parser.ex`). Replace the ALL-CAPS tolerant skip with the guarded version:
  ```elixir
  {:keyword, caps_kw, _loc} ->
    if Regex.match?(~r/^[A-Z_]+$/, caps_kw) and
         match?({:colon, _, _}, current_token(advance(state))) do
      # Fail-closed: safety-adjacent section names are a hard error.
      if Regex.match?(~r/^(REQUIRE|CONTRA|SAFETY|PRECAUTION|MEDICAL|CLEARANCE)/, caps_kw) do
        error = ParseError.invalid_structure(
          "Safety-adjacent section '#{caps_kw}:' is not a recognised WPL-AI keyword. " <>
            "A typo here would silently erase contraindications. " <>
            "Did you mean REQUIRES?",
          current_location(state)
        )
        state = %{state | errors: [error | state.errors]}
        {:error, Enum.reverse(state.errors)}
      else
        # Non-safety unknown section: record repair and skip body
        state = advance(state)  # skip keyword
        state = advance(state)  # skip ":"
        state = skip_newlines(state)
        state =
          case current_token(state) do
            {:indent, _, _} ->
              state = advance(state)
              skip_until_matching_dedent(state, 1)
            _ ->
              state
          end
        state = add_repair(state, %{
          type: :skipped_section,
          section: caps_kw,
          message: "Unknown top-level section \"#{caps_kw}\" skipped"
        })
        parse_sections(state, sections)
      end
    else
      parse_sections(advance(state), sections)
    end
  ```
  Note: when the safety-section error branch fires, `parse_sections` returns `{:error, ...}`. The outer `parse_document/1` uses `with`, so the error will propagate naturally.

- [ ] Implement strict contraindication severity and action in `parse_contraindication/1` (around line 721 in `lib/wpl_ai/parser.ex`). The valid severities are `["low", "moderate", "high"]` and valid actions are `["exclude", "modify", "require_clearance"]`. In both the keyword-form severity block and the keyword/arrow-form action block, replace the silent `nil`/`:exclude` defaults with errors:

  For severity (the `{:keyword, "severity", _}` branch at ~line 750):
  ```elixir
  {:keyword, "severity", _} ->
    state = advance(state)
    case current_token(state) do
      {tag, level, _} when tag in [:keyword, :bare_word] and level in ["low", "moderate", "high"] ->
        {String.to_atom(level), advance(state)}

      {_tag, bad_level, loc} ->
        error = ParseError.invalid_structure(
          "Unknown contraindication severity '#{bad_level}'. Expected: low, moderate, high.",
          loc
        )
        state_with_err = %{state | errors: [error | state.errors]}
        # Advance past the bad token and signal error via state
        # Return the error state; the outer parse_requires_body will see it
        # through the state.errors list.
        # We still return a nil severity to let parsing continue.
        {nil, advance(state_with_err)}
    end
  ```

  For action (the `{tag, "action", _}` branch at ~line 769):
  ```elixir
  {tag, "action", _} when tag in [:keyword, :bare_word] ->
    state = advance(state)
    case current_token(state) do
      {tag2, action_str, _} when tag2 in [:keyword, :bare_word] and
          action_str in ["exclude", "modify", "require_clearance"] ->
        {parse_contraindication_action(action_str), advance(state)}

      {_tag2, bad_action, loc} ->
        error = ParseError.invalid_structure(
          "Unknown contraindication action '#{bad_action}'. Expected: exclude, modify, require_clearance.",
          loc
        )
        state_with_err = %{state | errors: [error | state.errors]}
        {:exclude, advance(state_with_err)}
    end
  ```

  For the arrow-form action at ~line 729:
  ```elixir
  {:arrow, _, _} ->
    state = advance(state)
    case current_token(state) do
      {tag, action_str, _} when tag in [:keyword, :bare_word] and
          action_str in ["exclude", "modify", "require_clearance"] ->
        {parse_contraindication_action(action_str), advance(state)}

      {_tag, bad_action, loc} ->
        error = ParseError.invalid_structure(
          "Unknown contraindication action '#{bad_action}'. Expected: exclude, modify, require_clearance.",
          loc
        )
        state_with_err = %{state | errors: [error | state.errors]}
        {:exclude, advance(state_with_err)}
    end
  ```

  Because `parse_contraindication/1` is called inside `parse_requires_body/2` which threads `state`, we need it to return the updated state. Review the function signature: `parse_contraindication(state)` returns `{:ok, contra, state}`. The error additions to `state.errors` propagate correctly — when `parse_document` finishes, `state.errors` is reversed and returned.

- [ ] Run: `mix test test/wpl_ai/parser_test.exs` — expect new tests to PASS.

- [ ] Run quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "feat: fail-closed safety sections; strict contraindication severity/action (BREAKING)"
  ```

---

### A3 — Unknown-exercise warning in `WplAi.Validator`

**Purpose:** `WplAi.Validator.validate_semantics/1` currently only walks `progress.checkpoints`. The TS `validator.ts` at line 253 emits a warning when an `AST.Exercise` activity has an `exercise_ref` not present in the `ALL_EXERCISES` catalog (the same catalog `ExerciseMatcher` uses). Port this.

**Files:**
- `lib/wpl_ai/validator.ex`
- `test/wpl_ai/validator_test.exs`

**Steps:**

- [ ] Write failing test in `test/wpl_ai/validator_test.exs`. Look at existing test style — they call `WplAi.validate_semantics(doc)`:
  ```elixir
  describe "validate_semantics/1 - unknown exercise refs" do
    test "emits a warning for an exercise_ref absent from the catalog" do
      source = ~S"""
      PLAN "Unknown Ex Plan"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "D1":
              main straight_sets:
                totally_unknown_exercise_xyz 3x10
      """
      {:ok, doc, _repairs} = WplAi.parse(source)
      warnings = WplAi.validate_semantics(doc)

      unknown_warnings = Enum.filter(warnings, fn w ->
        String.contains?(w.message, "totally_unknown_exercise_xyz")
      end)

      assert length(unknown_warnings) >= 1
      assert hd(unknown_warnings).severity == :warning
    end

    test "does not emit a warning for a known exercise ref" do
      source = ~S"""
      PLAN "Known Ex Plan"
      TYPE workout
      PHASES
        PHASE "P1" (1 weeks):
          WEEK 1:
            DAY Monday training 30m "D1":
              main straight_sets:
                push_up 3x10
      """
      {:ok, doc, _repairs} = WplAi.parse(source)
      warnings = WplAi.validate_semantics(doc)

      unknown_warnings = Enum.filter(warnings, fn w ->
        String.contains?(w.message, "push_up") and w.severity == :warning
      end)

      assert unknown_warnings == []
    end
  end
  ```
  Run: `mix test test/wpl_ai/validator_test.exs` — expect new tests to FAIL.

- [ ] Add exercise catalog check in `lib/wpl_ai/validator.ex`. Add a private helper that checks if a ref is known (delegate to `ExerciseMatcher`):
  ```elixir
  alias WplAi.ExerciseMatcher

  defp validate_phases(warnings, phases) when is_list(phases) do
    Enum.reduce(phases, warnings, fn phase, acc ->
      validate_weeks(acc, phase.weeks || [])
    end)
  end

  defp validate_weeks(warnings, weeks) do
    Enum.reduce(weeks, warnings, fn week, acc ->
      validate_days(acc, week.days || [])
    end)
  end

  defp validate_days(warnings, days) do
    Enum.reduce(days, warnings, fn day, acc ->
      validate_blocks(acc, day.blocks || [])
    end)
  end

  defp validate_blocks(warnings, blocks) do
    Enum.reduce(blocks, warnings, fn block, acc ->
      validate_activities(acc, block.activities || [])
    end)
  end

  defp validate_activities(warnings, activities) do
    Enum.reduce(activities, warnings, fn activity, acc ->
      validate_activity(acc, activity)
    end)
  end

  defp validate_activity(warnings, %WplAi.AST.Exercise{exercise_ref: ref}) when is_binary(ref) do
    if ExerciseMatcher.known?(ref) do
      warnings
    else
      warning = %{
        severity: :warning,
        message: "'#{ref}' is not a known exercise in the catalog — it cannot be checked against contraindications by name; verify it is intentional"
      }
      [warning | warnings]
    end
  end
  defp validate_activity(warnings, _activity), do: warnings
  ```

- [ ] Update `validate_semantics/1` to also call the phase walker:
  ```elixir
  @spec validate_semantics(AST.Document.t()) :: [warning()]
  def validate_semantics(%AST.Document{} = doc) do
    []
    |> validate_phases(doc.phases || [])
    |> validate_progress(doc.progress)
    |> Enum.reverse()
  end
  ```

- [ ] Add `known?/1` predicate to `WplAi.ExerciseMatcher`. It should return `true` if the ref is in the `@all_exercises` set. Look at the existing module — it has `@all_exercises` as a module attribute (the concatenation of all category lists). Add:
  ```elixir
  @doc "Returns true if `ref` is present in the canonical exercise catalog."
  @spec known?(String.t()) :: boolean()
  def known?(ref) when is_binary(ref) do
    MapSet.member?(@exercise_set, ref)
  end
  ```
  And ensure `@exercise_set` is defined (add it if missing):
  ```elixir
  @exercise_set MapSet.new(@all_exercises)
  ```
  Check `lib/wpl_ai/exercise_matcher.ex` to see if `@all_exercises` already exists as a concatenation — read lines 50–120 of that file to verify the existing structure before adding.

- [ ] Run: `mix test test/wpl_ai/validator_test.exs` — expect new tests to PASS.

- [ ] Run quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "feat: unknown-exercise warning in WplAi.Validator.validate_semantics"
  ```

---

### A4 — End-to-end safety invariant test (with `wpl_validator` path dep)

**Purpose:** Compile a plan through `WplAi.to_wpl/1` and run `WPL.Enforce.enforce/4` on the output, asserting a contraindicated exercise (including plural variant `push_ups`) cannot survive.

**Files:**
- `mix.exs` (add path dep)
- `test/wpl_ai/safety_invariant_test.exs` (new)

**Steps:**

- [ ] Update `mix.exs` deps. The current dep at line 55 is:
  ```elixir
  {:wpl_validator, "~> 1.6", only: :test}
  ```
  Change to path dep pointing at the local 1.8 branch:
  ```elixir
  {:wpl_validator, path: "../wpl-validator-ex", only: :test}
  ```
  Run `mix deps.get` to resolve.

- [ ] Write `test/wpl_ai/safety_invariant_test.exs` (failing until dep is available):
  ```elixir
  defmodule WplAi.SafetyInvariantTest do
    use ExUnit.Case, async: false

    # This test verifies the end-to-end safety contract:
    # a contraindicated exercise compiled via WplAi.to_wpl/1 cannot survive
    # a call to WPL.Enforce.enforce/4.

    @source ~S"""
    PLAN "Safety Invariant"
    TYPE workout
    REQUIRES
      contraindication shoulder_impingement severity high action exclude
        affects push_up
    PHASES
      PHASE "P1" (1 weeks):
        WEEK 1:
          DAY Monday training 45m "Upper":
            main straight_sets:
              push_up 3x10
              squat 3x10
    """

    @source_plural ~S"""
    PLAN "Plural Safety Invariant"
    TYPE workout
    REQUIRES
      contraindication shoulder_impingement severity high action exclude
        affects push_up
    PHASES
      PHASE "P1" (1 weeks):
        WEEK 1:
          DAY Monday training 45m "Upper":
            main straight_sets:
              push_ups 3x10
              squat 3x10
    """

    test "a contraindicated exercise is stripped by enforce() after compilation" do
      {:ok, json, _repairs} = WplAi.to_wpl(@source)

      rules = [%{
        "id" => "no_shoulder_push",
        "condition" => %{"field" => "injuries", "op" => "contains", "value" => "shoulder_impingement"},
        "actions" => [%{"type" => "forbid_exercise", "exercise" => "push_up"}]
      }]
      ctx = %{injuries: ["shoulder_impingement"]}

      result = WPL.Enforce.enforce(json, ctx, rules)

      stripped_names = Enum.map(result.stripped, & &1.exercise)
      assert "push_up" in stripped_names,
             "Expected push_up to be stripped; stripped: #{inspect(stripped_names)}"

      surviving = collect_refs(result.plan)
      refute "push_up" in surviving,
             "push_up must not survive enforce(); surviving: #{inspect(surviving)}"
      assert "squat" in surviving, "squat must survive"
    end

    test "plural variant push_ups is stripped by enforce() (compound plural fix)" do
      {:ok, json, _repairs} = WplAi.to_wpl(@source_plural)

      rules = [%{
        "id" => "no_shoulder_push",
        "condition" => %{"field" => "injuries", "op" => "contains", "value" => "shoulder_impingement"},
        "actions" => [%{"type" => "forbid_exercise", "exercise" => "push_up"}]
      }]
      ctx = %{injuries: ["shoulder_impingement"]}

      result = WPL.Enforce.enforce(json, ctx, rules)

      # push_ups (plural) must collide with push_up forbid via SHORT_PLURALS stem
      assert length(result.stripped) >= 1,
             "Expected push_ups to be stripped; stripped was empty"
      assert "squat" in collect_refs(result.plan), "squat must survive"
    end

    defp collect_refs(plan) when is_map(plan) do
      (plan["plan"]["phases"] || [])
      |> Enum.flat_map(fn phase ->
        (phase["weeks"] || [])
        |> Enum.flat_map(fn week ->
          (week["days"] || [])
          |> Enum.flat_map(fn day ->
            (day["blocks"] || [])
            |> Enum.flat_map(fn block ->
              (block["activities"] || [])
              |> Enum.flat_map(fn act ->
                [act["exercise_ref"], act["name"]] |> Enum.filter(&is_binary/1)
              end)
            end)
          end)
        end)
      end)
    end
  end
  ```
  Run: `mix test test/wpl_ai/safety_invariant_test.exs` — expect FAIL (the path dep resolves once `wpl-validator-ex` is on the `v0.7-elixir-parity` branch with V4 complete).

- [ ] Once the dep resolves (confirm with `mix deps.compile`), run the test. Diagnose:
  - If `push_ups` is not stripped in the plural test: the wpl-ai compiler may be emitting `exercise_ref: "push_ups"` in the JSON. Verify with `IO.inspect(json)`. The `WPL.Enforce.Matcher` should handle this via `normalize("push_ups") == "push_up"`.
  - If `push_up` is not stripped in the singular test: check that the compiler emits `exercise_ref: "push_up"` (not a name with underscores that `resolve_exercise_ref` may have altered).

- [ ] Run quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```

- [ ] Commit:
  ```
  git commit -m "test: end-to-end safety invariant; add wpl_validator path dep for test"
  ```

---

### A5 — Release prep: version 2.0.0 + CHANGELOG

**Files:**
- `mix.exs`
- `CHANGELOG.md`

**Steps:**

- [ ] Update `mix.exs`: change `@version "1.13.0"` to `@version "2.0.0"`.

- [ ] Update `mix.exs` wpl_validator dep in production (if any): the dep is `only: :test` so no production impact. Leave as path dep for now; note that when publishing, user must change it back to `{:wpl_validator, "~> 1.8", only: :test}` (Hex version) — this is called out in the CHANGELOG.

- [ ] Update `CHANGELOG.md`: add a `[2.0.0]` entry at the top, following the existing Keep a Changelog style:
  ```markdown
  ## [2.0.0] — 2026-06-17

  ### BREAKING

  - `WplAi.to_wpl/1` now returns `{:ok, json, repairs}` (3-tuple). Callers
    matching `{:ok, json} = WplAi.to_wpl(src)` will receive a `MatchError`.
  - Unknown ALL-CAPS sections matching `REQUIRE*`, `CONTRA*`, `SAFETY*`,
    `PRECAUTION*`, `MEDICAL*`, or `CLEARANCE*` are now hard parse errors
    (previously skipped silently — a typo in `REQUIREMENTS:` erased all
    contraindications with no trace).
  - Unknown contraindication `severity` or `action` values are now hard parse
    errors (previously: severity dropped to nil, action defaulted to `:exclude`).

  ### Added

  - `repairs: [repair()]` on the success path of `WplAi.to_wpl/1` and
    `WplAi.Parser.parse/1`: every tolerant normalisation (skipped sections,
    future: fuzzy exercise substitutions, unknown-exercise-kept, lenient-default
    fabrications, discarded modifiers) is recorded as a repair map with a `:type`
    atom.
  - Semantic warning for exercise refs absent from the canonical `ALL_EXERCISES`
    catalog emitted by `WplAi.Validator.validate_semantics/1`.
  - End-to-end safety-invariant test: compiles a plan via `WplAi.to_wpl/1` then
    asserts a contraindicated exercise (including plural variant `push_ups`) cannot
    survive a call to `WPL.Enforce.enforce/4`.
  - New test-only dep: `{:wpl_validator, "~> 1.8"}`. **Before publishing**, change
    the path dep in mix.exs back to the Hex version `{:wpl_validator, "~> 1.8", only: :test}`.

  ### Notes
  - `WplAi.parse!/1`, `WplAi.validate/1`, `WplAi.to_wpl!/1` updated to handle
    the new 3-tuple without exposing repairs to callers who don't need them.
  ```

- [ ] Run final quality gate:
  ```bash
  mix compile --warnings-as-errors && mix format --check-formatted && mix test
  ```
  All tests must pass.

- [ ] Commit:
  ```
  git commit -m "chore: release 2.0.0"
  ```

---

## Self-review notes

### Cross-task type/name contracts

| Contract | Defined in | Consumed by |
|---|---|---|
| `WPL.Enforce.Matcher.collides/2` signature | V4a `lib/wpl/enforce/matcher.ex` | V4d `WPL.Enforce`, V5 conformance test |
| `WPL.Enforce.RuleEvaluator.evaluate_rules/2` return `%{evaluated, diagnostics}` | V4b | V4d, V5 |
| `WPL.Enforce.Cycle.compute_cycle_day/2` returns `integer() | nil` | V4c | V4d |
| `WPL.Enforce.enforce/3,4` return map keys `:plan, :evaluated_rules, :stripped, :diagnostics` | V4d | V5 conformance, A4 safety invariant |
| `WplAi.Parser.parse/1` returns `{:ok, doc, repairs} | {:error, errors}` | A1 | A2, A3, A4, all existing tests |
| `WplAi.to_wpl/1` returns `{:ok, json, repairs} | {:error, errors}` | A1 | A4 safety invariant |
| `WplAi.ExerciseMatcher.known?/1` predicate | A3 | A3 validator |
| `{:wpl_validator, path: ...}` in wpl-ai-ex mix.exs | A4 | A4 only; revert to Hex version before publish |

### Reality-vs-plan risk points

1. **`parse_sections/2` return type change (A2)**: the safety-section guard currently returns `{:error, ...}` from inside a recursive function that previously always returned `{:ok, sections, state}`. The `with` in `parse_document/1` expects a 3-tuple from `parse_sections`. If the function returns a 2-tuple error, the `with` match will fail with a bare error tuple. Test this carefully — may need to add the `|> then/1` or restructure `parse_sections` to accumulate errors in state and signal via `state.errors` rather than early-returning. Adapt as needed.

2. **`parse_contraindication/1` threading state through errors (A2)**: the function currently returns `{:ok, contra, state}` unconditionally. Adding `state.errors` accumulation on bad severity/action is the safe path (avoids changing the return type). However, since `parse_tokens/1` checks `state.errors` at the end and emits `{:error, ...}` if any errors present, this correctly surfeces the errors as hard failures without restructuring the recursive descent.

3. **Phase index in stripped paths (V4d/V5)**: the path tracking in `walk_phases/8` uses `length(acc_phases)` (which counts output phases added so far) as the phase index. Since phases are processed in order and the output is built by prepending then reversing, this could produce incorrect indices. The conformance fixture `forbid-static.json` uses a single-phase plan, so it won't reveal multi-phase bugs. Verify with a hand-traced example before committing V5.

4. **`ExerciseMatcher.known?/1` and `@exercise_set` (A3)**: the existing module already has `@all_exercises` as a concatenated list (inferred from `exercises_by_category/0` return and the module attribute structure visible at lines 24–50). Add `@exercise_set MapSet.new(@all_exercises)` above the public API section; confirm `@all_exercises` is defined before this attribute.

5. **Compile-result envelope shape (A1)**: chosen `{:ok, json, repairs}` 3-tuple over `%WplAi.CompileResult{}` struct. The struct approach would be cleaner for documentation but is more disruptive: every `with {:ok, json} <- WplAi.to_wpl(src)` call in tests and callers breaks in the same way either way (both are BREAKING). The 3-tuple is preferred because it is the idiomatic Elixir extension pattern and matches how callers would write `{:ok, json, _repairs} = WplAi.to_wpl(src)` for the common "I don't care about repairs" case with a minimal diff.

6. **wpl-ai-ex `mix.exs` path dep before publish**: A4 switches the dep to a local path dep for development. This dep MUST be reverted to `{:wpl_validator, "~> 1.8", only: :test}` (Hex version) before `mix hex.publish` runs. The A5 CHANGELOG entry calls this out. The `.github/workflows/publish.yml` pipeline will fail if it tries to resolve a path dep from the CI environment.

7. **`WplAi.round_trip/1` (lib/wpl_ai.ex, line 179)**: this function calls `to_wpl/1` internally. After A1 it will receive `{:ok, json, _repairs}` — update the `with` clause accordingly:
   ```elixir
   def round_trip(source) when is_binary(source) do
     with {:ok, json, _repairs} <- to_wpl(source),
          {:ok, text} <- decompile(json) do
       {:ok, text}
     end
   end
   ```
   This is a call site update required in A1 but easy to miss since it is in `lib/wpl_ai.ex` not the parser.
