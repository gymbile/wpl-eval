# experiments/ — one-off probe results

Results of ad-hoc, in-cycle probes: small paid runs answering a single
design question. They are **not** part of any locked corpus and are not
cited as headline numbers — but several informed published findings (the
direct-JSON and END-markers findings in `docs/V0_6_RESULTS.md`).

| dir | question it answered |
|---|---|
| `native-json*` (4 dirs) | can models emit valid WPL JSON directly, skipping the DSL? (No — 0/5 schema-valid at 12-week scale; the DSL→compile path is doing real work.) |
| `dsl-end-markers*` (3 dirs) | does an END-marker surface form help small-model compile rates? (Yes, for Haiku-class models.) |
| `plan-then-translate/` | two-step plan-then-translate pipeline probe. |

Each dir was produced by the matching `src/scripts/*-probe.ts` /
`plan-then-translate.ts` script, which documents its own protocol.
