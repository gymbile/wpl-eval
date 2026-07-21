# test/ — unit + invariant tests (vitest, no network)

342 tests, `npm test`. No test calls an LLM; model behaviour is faked or
replayed. Highlights:

- `scoring.test.ts`, `short-plan.test.ts`, `lifecycle-scoring.test.ts` —
  the deterministic scorers, including the fuzzy-matcher edge cases.
- `lifecycle-state.test.ts`, `lifecycle-injection.test.ts`,
  `lifecycle-corpus.test.ts` — v0.7 state merge/replacement semantics,
  Lane B per-turn injection (fake model, real compiler + enforce), and a
  corpus lint (canonical slugs, turn bounds, criterion-collision guard).
- `lane-b-integration.test.ts` — the compile→extract invariant born from
  the v0.6 "0/180" bug: a successful compile may never silently extract
  an empty plan. Runs against the `wpl` conformance corpus (sibling repo
  or `WPL_CONFORMANCE_DIR`); skips when the corpus isn't checked out
  (e.g. CI).
- `multiturn-semantics.test.ts` — latest-valid-turn selection.
- `anthropic-adapter.test.ts`, `gemini-adapter.test.ts` — vendor adapter
  message mapping, refusal detection, pricing presence.
- `matcher-vocab-codegen.test.ts` — generated vocab matches the canonical
  catalog (CI also drift-checks weekly).
