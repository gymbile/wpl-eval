# LinkedIn post — v0.7.0 lifecycle results

*Draft for Alex to post manually. Pairs with the blog post
"Your AI Trainer Can't Take Back What It Already Prescribed"
(alexfilatov.com) and wpl.dev/eval/lifecycle.*

---

I told 10 AI models that my client pulled her hamstring.

9 of them kept prescribing deadlifts.

That's the headline from v0.7 of my open AI-safety benchmark for fitness programming. The new corpus tests the thing no demo ever shows: what happens when the client CHANGES mid-programme.

Real coaching isn't a one-shot plan. Clients get injured at week 3. They get cleared at week 7. They travel with nothing but a hotel gym. A cardiac client gets pulled back a phase after chest tightness. Five scripted life events, 8-turn trainer conversations, 100 trials across OpenAI, Anthropic, and Google.

Raw LLMs, tracking the client's state from conversation alone:
→ 210 state-conditional safety violations
→ 9/10 models kept forbidden posterior-chain work after the injury was reported
→ 9/10 kept barbell work during the hotel-gym weeks
→ regression (constraints TIGHTENING) leaked on every vendor

Same models, routed through the WPL governance layer — plans written in a strict grammar, compiled, validated, and filtered by a rule engine that re-applies the client's current profile on every turn:
→ 10 violations. 21× fewer.
→ 10/10 models passed the injury and travel criteria
→ criterion pass rate 65% → 94%

Two findings I didn't expect:

1. The "rewrite history" failure never happened. Every model correctly preserved past restrictions in consolidated plans. The gap isn't memory — it's REMOVAL. LLMs add gracefully and un-prescribe terribly.

2. Bigger models still aren't safer raw. Opus 4.7 and Gemini 3.5 Flash sit near the top of the raw violation table. Model capability keeps failing to buy safety; the governance layer keeps delivering it, nearly flat across the whole lineup.

And the honest column, because a benchmark that hides its residuals is marketing: 8 of the 10 governed violations are progression failures (a cleared exercise never re-introduced — governance can strip, it can't programme the comeback), and 2 exposed a real gap: my rules forbid exercises but can't cap intensity yet. Both are now scoped v0.8 work. That's what an eval is FOR.

Everything is open — scenarios, scoring code, all 100 raw per-trial artifacts. Reproduce it for ~$60, or re-derive every number offline for $0.

Results: wpl.dev/eval/lifecycle
Repo: github.com/gymbile/wpl-eval

If you're building LLM products that maintain a long-lived artifact for a changing human — care plans, portfolios, curricula — this failure shape is yours too. The model will handle the additions. It will quietly fail the removals.

#AIEngineering #LLM #AISafety #FitnessTech #BuildInPublic

---

*Posting notes: hook line first (the hamstring line), no link in the
first comment debate — links are in-body per recent LinkedIn reach
behaviour being acceptable for follower-first posts; alternatively move
both links to the first comment. Best slots: Tue/Wed 8–10am UK.*
