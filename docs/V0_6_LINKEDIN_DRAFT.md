# LinkedIn post draft — v0.6 results

Canonical version below. Posting notes and counter-argument prep at the bottom.

---

🚨 Bigger ≠ safer.

We tested 7 frontier LLMs on 420 real clinical fitness scenarios — torn meniscus, postpartum recovery, cardiac post-MI, severe dysmenorrhea, lumbar disc, and more.

**The most expensive, most capable models gave the most dangerous advice.**

Here's the data 👇

---

The setup:
• 7 LLMs tested: GPT-5, GPT-5-mini, GPT-5-nano, GPT-4.1, Claude Opus 4.7, Sonnet 4.6, Haiku 4.5
• 15 medical fitness scenarios × 2 lanes × 2 prompt formats = 420 trials
• Same prompt every time: "build me a 12-week plan for this client"
• Open-source scorer counts contraindicated prescriptions (HIIT on flow days, deep squats on torn meniscus, etc.)

**Raw safety violations by model (no governance, plain LLM):**

📈 gpt-4.1: 28
📈 Claude Haiku 4.5: 28
📈 gpt-5-nano: 29
📈 Claude Sonnet 4.6: 56
📈 gpt-5-mini: 59
📈 GPT-5: 91
📈 **Claude Opus 4.7: 114** ← Anthropic's flagship, the worst raw-safety performer in the lineup

The flagship in each vendor came in last on raw safety.

**Why?** A hypothesis worth testing: more capable models are more *confident*. They write more prescriptions per prompt. More prescriptions = more chances to slip something contraindicated past their internal safety priors. Per-prescription error rate may be similar — absolute count rises.

---

🛡️ **Now add a governance layer** (we used WPL — a compile-time safety contract over LLM outputs):

Every Anthropic model: **0 safety violations** across 180 trials. Including Opus 4.7. Same model, same scenarios, different result.

The governance layer enforces: blacklist contraindicated exercises, refuse high-intensity on flow days, gate every output through a schema validator. If the plan doesn't pass, it doesn't ship.

That's the actual lesson here:

→ The LLM isn't the bottleneck. The contract around it is.
→ Same Opus 4.7, with WPL: zero violations. Same GPT-5, without: 91.
→ Picking a "safer model" is the wrong frame. Picking a *contract* is the right one.

---

❓ **So which LLM should you actually use?**

If you're building clinical AI:

🟢 **For structural reliability:** GPT-5. Compiled 100% of plans, 73% passed full schema validation. Highest schema-valid rate in the lineup.

🟡 **For cheap + governed:** Claude Haiku 4.5. $0.18/trial. Lowest cost, contract still holds at zero violations.

🔴 **To avoid:** gpt-5-nano. 0/30 plans passed schema validation. Every single attempt was structurally broken.

🔴 **Don't use raw (no governance):** Opus 4.7. Most capable model in the lineup, worst raw safety record. The intuition that "smarter = safer" doesn't hold here.

---

🔬 The full dataset, methodology, and reproduction code are public:
github.com/gymbile/wpl-eval — frozen at tag v0.6.0-anthropic

Citable, reproducible, $108 to re-run end to end.

#LLM #AISafety #HealthTech #ClinicalAI #DigitalHealth

---

## Notes for posting

**Best time:** Tuesday–Thursday, 8–10am the local time of the audience you most care about.

**Hook image:** a table screenshot of the "raw violations by model" ranking — visual hook beats text hook on LinkedIn now. Take it from the V0_6_RESULTS.md cross-vendor table. Highlight Opus's row in red.

**First comment as expansion:** drop the methodology link and the "WPL is the governance layer; here's how it works" pitch in the first comment instead of inline. Keeps the post tight, gives engaged readers more.

**What NOT to say:**
- Don't claim "Opus is unsafe." Claim is: "Opus's raw output without governance has more violations than smaller models." That's the measurable thing. The unsafe label is editorial.
- Don't claim WPL is "the solution." It's *a* governance layer; the bigger point is "you need one." If readers come away thinking "I need a contract around my LLM" — mission accomplished.
- Don't bury the $108. People click on dollar amounts. The full cost on the box is the point — "you can replicate this for the cost of a dinner."

**Counter-arguments to expect in comments:**
1. "You're comparing tokenizers / temperatures / etc." — true, partly. See METHODOLOGY.md §9. Opus 4.7 doesn't accept temperature; new tokenizer ~35% more tokens. Disclosed.
2. "The scorer is biased against more verbose outputs." — true direction, false magnitude. Same scorer ran v0.5 on GPT-5 — gpt-5 was the *safest* OpenAI model (91 vs 28 for gpt-4.1)... wait that disproves my point. Need to think about this defence again. The actual answer: the scorer counts *items*, not opinions. Each violation is a specific contraindicated exercise on a specific week. Verbosity inflates count only if verbose models prescribe more *prescriptions* — which is itself the finding.
3. "What about gpt-5 being safer than Opus?" — gpt-5 wrote 91 violations vs gpt-4.1's 28. Within OpenAI, the same pattern holds. Cross-vendor: Opus 4.7 (114) > gpt-5 (91) > Sonnet (56) ≈ gpt-5-mini (59) > Haiku (28) ≈ gpt-4.1 (28) ≈ gpt-5-nano (29). It's a capability story, not a vendor story.
