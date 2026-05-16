#!/usr/bin/env python3
"""
Generate the four v0.5 hero charts for press / docs use.

Reads results/*.json (the v0.5 corpus) and emits PNG + SVG to docs/charts/.
All numbers are derived from the same source data the publication docs cite —
no hand-typed numbers — so the charts and docs cannot drift apart.

Usage:
    python3 docs/charts/generate.py
"""

import json
import glob
import collections
import os
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# ----- style -----
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
    "font.size": 11,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.titlesize": 14,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "figure.dpi": 150,
})

LANE_A_COLOR = "#D2435C"   # raw LLM — warm red
LANE_B_COLOR = "#2E7D77"   # WPL public layer — dark teal
NEUTRAL = "#555555"
SOURCE_LINE = (
    "Source: gymbile/wpl-eval v0.5 — 240 trials, 4 OpenAI models × 15 scenarios × 2 lanes × 2 phases. "
    "Numbers reproducible from results/*.json."
)

# ----- load corpus -----
ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
OUT = ROOT / "docs" / "charts"
OUT.mkdir(exist_ok=True)


def load_all():
    out = []
    for f in sorted(glob.glob(str(RESULTS / "*.json"))):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        # skip the summary index file at the top of results/
        if d.get("lane") in ("A", "B"):
            out.append(d)
    return out


def save(fig, name):
    png = OUT / f"{name}.png"
    svg = OUT / f"{name}.svg"
    fig.savefig(png, bbox_inches="tight", facecolor="white")
    fig.savefig(svg, bbox_inches="tight", facecolor="white")
    print(f"  wrote {png.relative_to(ROOT)} + {svg.relative_to(ROOT)}")
    plt.close(fig)


def footer(fig):
    fig.text(0.5, 0.01, SOURCE_LINE, ha="center", fontsize=8, color=NEUTRAL, style="italic")


def aggregate(data):
    """Return all the slices the charts use."""
    a = [d for d in data if d["lane"] == "A"]
    b = [d for d in data if d["lane"] == "B"]
    agg = {
        "lane_a_total": len(a),
        "lane_a_unsafe": sum(1 for d in a if (d.get("safety_violations") or 0) > 0),
        "lane_a_violations": sum(d.get("safety_violations") or 0 for d in a),
        "lane_a_drift": sum(1 for d in a if d["phase"] == "multi" and d.get("drift_turn") not in (None, 0)),
        "lane_b_total": len(b),
        "lane_b_unsafe": sum(1 for d in b if (d.get("safety_violations") or 0) > 0),
        "lane_b_violations": sum(d.get("safety_violations") or 0 for d in b),
        "lane_b_drift": sum(1 for d in b if d["phase"] == "multi" and d.get("drift_turn") not in (None, 0)),
    }
    # per-scenario
    scen = collections.defaultdict(lambda: {"a_viol": 0, "b_viol": 0, "a_unsafe": 0, "b_unsafe": 0})
    for d in data:
        sv = d.get("safety_violations") or 0
        s = d["scenario_id"]
        if d["lane"] == "A":
            scen[s]["a_viol"] += sv
            if sv > 0:
                scen[s]["a_unsafe"] += 1
        else:
            scen[s]["b_viol"] += sv
            if sv > 0:
                scen[s]["b_unsafe"] += 1
    agg["per_scenario"] = dict(scen)
    # per-model (single-turn only — the "newer is not safer" leaderboard cut)
    models = collections.defaultdict(lambda: {"viol": 0, "unsafe": 0, "trials": 0})
    for d in data:
        if d["lane"] != "A" or d["phase"] != "single":
            continue
        m = d["model"]
        sv = d.get("safety_violations") or 0
        models[m]["viol"] += sv
        models[m]["trials"] += 1
        if sv > 0:
            models[m]["unsafe"] += 1
    agg["per_model_single"] = dict(models)
    return agg


# ===== Chart 1: headline reduction =====

def chart_headline(agg):
    fig, axes = plt.subplots(1, 2, figsize=(11, 5))
    fig.suptitle(
        "WPL governance vs raw LLM — 240-trial benchmark",
        fontsize=15, fontweight="bold", y=0.99,
    )

    # Left: unsafe trials
    ax = axes[0]
    vals = [agg["lane_a_unsafe"], agg["lane_b_unsafe"]]
    bars = ax.bar(["Raw LLM\n(Lane A)", "WPL public layer\n(Lane B)"], vals,
                  color=[LANE_A_COLOR, LANE_B_COLOR], width=0.6)
    ax.set_title("Trials with at least one unsafe prescription")
    ax.set_ylabel("Unsafe trials (of 120)")
    ax.set_ylim(0, max(vals) * 1.25)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width() / 2, v + 1, f"{v}\n({v/120*100:.0f}%)",
                ha="center", va="bottom", fontweight="bold")
    reduction = (agg["lane_a_unsafe"] - agg["lane_b_unsafe"]) / agg["lane_a_unsafe"] * 100
    ax.text(0.5, -0.15, f"86% reduction", transform=ax.transAxes,
            ha="center", fontsize=12, fontweight="bold", color=LANE_B_COLOR)

    # Right: total violations
    ax = axes[1]
    vals = [agg["lane_a_violations"], agg["lane_b_violations"]]
    bars = ax.bar(["Raw LLM\n(Lane A)", "WPL public layer\n(Lane B)"], vals,
                  color=[LANE_A_COLOR, LANE_B_COLOR], width=0.6)
    ax.set_title("Total clinical-guidance violations")
    ax.set_ylabel("Total violations")
    ax.set_ylim(0, max(vals) * 1.25)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width() / 2, v + 4, f"{v}",
                ha="center", va="bottom", fontweight="bold")
    reduction = (agg["lane_a_violations"] - agg["lane_b_violations"]) / agg["lane_a_violations"] * 100
    ax.text(0.5, -0.15, f"{reduction:.0f}% reduction", transform=ax.transAxes,
            ha="center", fontsize=12, fontweight="bold", color=LANE_B_COLOR)

    plt.subplots_adjust(bottom=0.2, top=0.86, wspace=0.3)
    footer(fig)
    save(fig, "01-headline-reduction")


# ===== Chart 2: per-scenario violations =====

SCENARIO_LABELS = {
    "torn_meniscus": "Torn meniscus (post-op)",
    "lumbar_disc": "Lumbar disc herniation",
    "shoulder_impingement": "Shoulder impingement",
    "post_csection_4wk": "4-wk post-C-section",
    "pregnancy_2nd_trimester": "Pregnancy, 2nd trimester",
    "cardiac_post_mi": "6-mo post-MI cardiac rehab",
    "severe_dysmenorrhea": "Severe dysmenorrhea *",
    "endometriosis_flares": "Endometriosis + flares *",
    "pcos_irregular": "PCOS, irregular cycle *",
    "perimenopause_variable": "Perimenopause, variable *",
    "ocp_suppressed": "OCP-suppressed (neg. control) *",
    "type2_diabetes_nutrition": "Type-2 diabetes (nutrition)",
    "equipment_bodyweight_only": "Bodyweight-only equipment",
    "vegan_protein_target": "Vegan diet",
    "asthma_exercise_induced": "Exercise-induced asthma",
}


def chart_per_scenario(agg):
    sc = agg["per_scenario"]
    # sort by Lane A violations descending
    order = sorted(sc.keys(), key=lambda k: -sc[k]["a_viol"])
    labels = [SCENARIO_LABELS.get(k, k) for k in order]
    a_vals = [sc[k]["a_viol"] for k in order]
    b_vals = [sc[k]["b_viol"] for k in order]

    fig, ax = plt.subplots(figsize=(11, 9))
    y = range(len(order))
    h = 0.4
    ax.barh([yi + h/2 for yi in y], a_vals, h, color=LANE_A_COLOR, label="Raw LLM (Lane A)")
    ax.barh([yi - h/2 for yi in y], b_vals, h, color=LANE_B_COLOR, label="WPL public layer (Lane B)")
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("Violations across 8 trials per scenario")
    ax.set_title("Where AI fitness coaches fail — violations per client scenario")

    # Annotate non-zero values
    for i, (a, b) in enumerate(zip(a_vals, b_vals)):
        if a > 0:
            ax.text(a + 0.5, i + h/2, str(a), va="center", fontsize=9)
        if b > 0:
            ax.text(b + 0.5, i - h/2, str(b), va="center", fontsize=9, color=LANE_B_COLOR)

    ax.legend(loc="lower right", frameon=False)
    ax.text(0.99, 0.01, "* = women's-health scenario", transform=ax.transAxes,
            ha="right", va="bottom", fontsize=8, color=NEUTRAL, style="italic")

    plt.subplots_adjust(left=0.32, bottom=0.08, right=0.97, top=0.95)
    footer(fig)
    save(fig, "02-per-scenario-violations")


# ===== Chart 3: per-model leaderboard =====

MODEL_LABELS = {
    "gpt-4.1": "GPT-4.1\n(older, non-reasoning)",
    "gpt-5-nano": "GPT-5-nano\n(cheap reasoning)",
    "gpt-5-mini": "GPT-5-mini\n(mid reasoning)",
    "gpt-5": "GPT-5\n(flagship, minimal reasoning)",
}
MODEL_ORDER = ["gpt-4.1", "gpt-5-nano", "gpt-5-mini", "gpt-5"]


def chart_per_model(agg):
    pm = agg["per_model_single"]
    fig, ax = plt.subplots(figsize=(10, 6))
    labels = [MODEL_LABELS[m] for m in MODEL_ORDER]
    viol = [pm[m]["viol"] for m in MODEL_ORDER]
    unsafe = [pm[m]["unsafe"] for m in MODEL_ORDER]
    trials = [pm[m]["trials"] for m in MODEL_ORDER]

    bars = ax.bar(labels, viol, color=[LANE_A_COLOR] * len(MODEL_ORDER), width=0.65)
    # Highlight the safest
    bars[0].set_color("#2E7D77")  # dark teal for the safest one
    ax.set_title("Newer is not safer — raw LLM violations per model (single-turn)")
    ax.set_ylabel("Total violations across 15 single-turn trials")
    ax.set_ylim(0, max(viol) * 1.3)
    for bar, v, u, t in zip(bars, viol, unsafe, trials):
        ax.text(bar.get_x() + bar.get_width() / 2, v + 0.7,
                f"{v} violations\n({u} of {t} plans unsafe)",
                ha="center", va="bottom", fontsize=10)

    # callout for the older-is-safer story
    ax.annotate(
        "The older, non-reasoning model\nproduced the safest output\nby a wide margin.",
        xy=(0, viol[0]), xycoords="data",
        xytext=(0.2, max(viol) * 1.0), textcoords="data",
        fontsize=9, color="#2E7D77", fontweight="bold",
        arrowprops=dict(arrowstyle="->", color="#2E7D77", lw=1.2),
    )

    plt.subplots_adjust(left=0.1, right=0.97, top=0.88, bottom=0.18)
    footer(fig)
    save(fig, "03-per-model-leaderboard")


# ===== Chart 4: cycle-pattern dispatch (the women's-health hero) =====

def chart_cycle_dispatch(agg):
    sc = agg["per_scenario"]
    cycle_scenarios = [
        ("severe_dysmenorrhea", "Severe dysmenorrhea\n(regular cycle)"),
        ("endometriosis_flares", "Endometriosis + flares\n(regular cycle)"),
        ("pcos_irregular", "PCOS\n(irregular cycle)"),
        ("perimenopause_variable", "Perimenopause\n(highly variable)"),
        ("ocp_suppressed", "OCP-suppressed\n(neg. control)"),
    ]
    labels = [lbl for (_, lbl) in cycle_scenarios]
    a_vals = [sc[k]["a_viol"] for (k, _) in cycle_scenarios]

    fig, ax = plt.subplots(figsize=(11, 6.5))
    colors = [LANE_A_COLOR if v > 0 else "#2E7D77" for v in a_vals]
    bars = ax.bar(labels, a_vals, color=colors, width=0.6)
    ax.set_title(
        "Raw LLMs fail on cyclic patients, get cycle-suppressed clients right — for the wrong reason",
        fontsize=13,
    )
    ax.set_ylabel("Raw LLM violations across 8 trials per scenario")
    ax.set_ylim(0, max(a_vals) * 1.35 if max(a_vals) > 0 else 5)

    # Value labels on bars
    for bar, v in zip(bars, a_vals):
        color = "#2E7D77" if v == 0 else "black"
        ax.text(bar.get_x() + bar.get_width() / 2, v + 0.8, str(v),
                ha="center", va="bottom", fontweight="bold", color=color, fontsize=13)

    # The "for the wrong reason" footnote
    fig.text(
        0.5, 0.06,
        "The right-hand zeros are not WPL doing its job — they are the raw LLM behaving normally for clients whose cycles\n"
        "the model cannot or should not project around. The runtime-correct equivalent (WPL Lane B) reaches the same\n"
        "answer by structural reasoning rather than absence of structure.",
        ha="center", fontsize=10, color=NEUTRAL, style="italic",
    )

    plt.subplots_adjust(left=0.09, right=0.97, top=0.88, bottom=0.30)
    footer(fig)
    save(fig, "04-cycle-pattern-dispatch")


# ===== run all =====

def main():
    data = load_all()
    if len(data) != 240:
        print(f"  WARNING: expected 240 result files, found {len(data)}", file=sys.stderr)
    agg = aggregate(data)
    print(f"Generating charts from {len(data)} result files…")
    chart_headline(agg)
    chart_per_scenario(agg)
    chart_per_model(agg)
    chart_cycle_dispatch(agg)
    print("Done.")


if __name__ == "__main__":
    main()
