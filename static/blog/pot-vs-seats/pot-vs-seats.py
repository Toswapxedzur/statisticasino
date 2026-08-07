#!/usr/bin/env python3
"""
Pot size vs number of seated players — full analysis pipeline.

Reproduces every numerical result and figure used in the blog post
"Does table size drive pot size? A LINER-checked walk through three
tests on 1238 hands":

    https://www.sinostatistica.net/blog/pot-vs-seats-bootstrap

Tests run, in order:
    A.  Chi-square test of independence on a 4 x 4 contingency table.
    B.  Log-linear OLS slope t-test (regress log(pot) on num_seats).
    C.  Lack-of-fit F-test on the log scale (compare linear vs saturated).

A would-be Test 1 (raw OLS slope t-test) is computed for the LINER
diagnostic only and *not reported* as inference, because LINER fails
on the raw scale.

Inputs:   pot-vs-seats-data.zip (the CSV bundle exported from
          /data/export-csv on statisticasino).
Outputs:  fig-*.png in the same directory and stdout summary.

Run:      python3 pot-vs-seats.py
Depends:  pandas, numpy, scipy, statsmodels, matplotlib.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy.stats import chi2_contingency

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
DATA_ZIP = HERE / "pot-vs-seats-data.zip"   # next to this script
OUT = HERE                                  # write figures next to this script
BB = 2                                      # 1/2 NL: big blind = 2 chips
RNG = np.random.default_rng(20260524)       # for jitter on scatter plots


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_bundle(zip_path: Path):
    """Read hands.csv and actions.csv out of the export ZIP."""
    zf = zipfile.ZipFile(zip_path)

    def _read(name):
        member = next(n for n in zf.namelist() if n.endswith(name))
        return pd.read_csv(io.BytesIO(zf.read(member)))

    return _read("hands.csv"), _read("actions.csv")


def build_dataset(hands: pd.DataFrame, actions: pd.DataFrame) -> pd.DataFrame:
    """Aggregate voluntary chips into per-hand pot_BB.

    Voluntary chips = bet + call + raise + allIn (excludes blinds).
    """
    voluntary = (actions
                 .query("action in ['bet','call','raise','allIn'] and chips > 0")
                 .groupby("hand_key")["chips"].sum()
                 .rename("pot_chips"))
    df = (hands.set_index("hand_key")
                .join(voluntary, how="inner")
                .assign(pot_bb=lambda d: d.pot_chips / BB)
                .query("pot_bb > 0 and 2 <= num_seats <= 9")
                .reset_index()
                .sort_values(["table_id", "first_ts"])
                .reset_index(drop=True))
    df["log_pot"] = np.log(df.pot_bb)
    return df


# ---------------------------------------------------------------------------
# Descriptive summary (data tour)
# ---------------------------------------------------------------------------

def descriptive_summary(df: pd.DataFrame) -> None:
    n = len(df)
    print(f"n rounds                : {n}")
    print(f"n distinct tables       : {df.table_id.nunique()}")
    print(f"hands per num_seats     : "
          f"{dict(df.num_seats.value_counts().sort_index())}")
    print(f"pot quartiles (BB)      : "
          f"{df.pot_bb.quantile([.05,.25,.5,.75,.95]).round(1).to_list()}")
    print(f"pot mean / sd  (BB)     : "
          f"{df.pot_bb.mean():.2f} / {df.pot_bb.std():.2f}\n")

    per_table = (df.groupby("table_id")
                   .agg(n_hands=("pot_bb", "size"),
                        seats_min=("num_seats", "min"),
                        seats_max=("num_seats", "max"),
                        seats_modal=("num_seats", lambda s: s.mode().iloc[0]),
                        pot_median=("pot_bb", "median"),
                        pot_mean=("pot_bb", "mean")))
    per_table["table_label"] = (df.groupby("table_id").table_name.first()
                                  .str.replace("Low Stakes - ", "")
                                  .str.replace(" - 1/2 - NL Holdem", ""))
    print("=== Per-table summary ===")
    print(per_table.round(1).to_string(), "\n")
    return per_table


# ---------------------------------------------------------------------------
# Test A — Chi-square test of independence
# ---------------------------------------------------------------------------

def test_a_chi_square(df: pd.DataFrame):
    pot_q = df.pot_bb.quantile([.25, .5, .75]).values
    df["pot_cat"] = pd.cut(df.pot_bb,
                           bins=[-np.inf, *pot_q, np.inf],
                           labels=["tiny", "small", "medium", "big"])
    df["seat_cat"] = pd.cut(df.num_seats,
                            bins=[1, 3, 5, 6, 9],
                            labels=["HU/3", "4-5", "6-max", "full ring"])
    ct = pd.crosstab(df.seat_cat, df.pot_cat)

    chi2, chi_p, chi_dof, chi_exp = chi2_contingency(ct)
    cramers_v = np.sqrt(chi2 / (len(df) * (min(ct.shape) - 1)))

    print("=== Test A: Chi-square test of independence ===")
    print("Observed counts:")
    print(ct.to_string())
    print(f"\n  χ² = {chi2:.2f}, df = {chi_dof}, p = {chi_p:.3g}")
    print(f"  Cramer's V = {cramers_v:.3f}\n")

    return ct, chi_exp, chi2, chi_p, chi_dof, cramers_v


# ---------------------------------------------------------------------------
# Test B — Log-linear OLS slope t-test
# ---------------------------------------------------------------------------

def test_b_log_linear(df: pd.DataFrame):
    fit = smf.ols("log_pot ~ num_seats", data=df).fit()
    b1, se = fit.params["num_seats"], fit.bse["num_seats"]
    print("=== Test B: Log-linear OLS slope t-test ===")
    print(f"  β̂₀ = {fit.params['Intercept']:.4f}, β̂₁ = {b1:.4f}")
    print(f"  SE(β̂₁) = {se:.4f}, "
          f"t = {fit.tvalues['num_seats']:.3f}, "
          f"p = {fit.pvalues['num_seats']:.3g}")
    print(f"  95% CI on β₁ (log)   = "
          f"{fit.conf_int().loc['num_seats'].round(4).to_list()}")
    print(f"  Multiplicative effect e^β̂₁ = {np.exp(b1):.3f} per seat")
    print(f"  HU → 6-max factor    = e^(4·β̂₁) = {np.exp(4*b1):.3f}")
    print(f"  R²                   = {fit.rsquared:.4f}\n")
    return fit


# ---------------------------------------------------------------------------
# Test C — Lack-of-fit F-test on the log scale
# ---------------------------------------------------------------------------

def test_c_lack_of_fit(df: pd.DataFrame, lin_log):
    saturated = smf.ols("log_pot ~ C(num_seats)", data=df).fit()
    table = sm.stats.anova_lm(lin_log, saturated)
    print("=== Test C: Lack-of-fit F-test (log scale) ===")
    print(table.round(4).to_string())
    p = table["Pr(>F)"].iloc[1]
    print(f"\n  lack-of-fit p ≈ {p:.3g}\n")
    return saturated, table


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

def fig_hist(df: pd.DataFrame) -> None:
    """Pot-size histogram, linear vs log."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
    ax1.hist(df.pot_bb, bins=80, color="#888", alpha=0.85, edgecolor="white")
    ax1.set_xlabel("Pot size (BB)")
    ax1.set_ylabel("Hands")
    ax1.set_title(f"Pot size distribution, linear scale "
                  f"(n = {len(df)}, mean = {df.pot_bb.mean():.1f} BB, "
                  f"median = {df.pot_bb.median():.1f} BB)")
    ax2.hist(df.log_pot, bins=60, color="#3a6", alpha=0.85, edgecolor="white")
    ax2.set_xlabel("log(pot size, BB)")
    ax2.set_ylabel("Hands")
    ax2.set_title("Pot size distribution, log scale")
    fig.tight_layout()
    fig.savefig(OUT / "fig-hist.png", dpi=150)


def fig_seat_counts(df: pd.DataFrame) -> None:
    """Bar chart of hand counts per seat-count tier."""
    counts = df.num_seats.value_counts().sort_index()
    fig, ax = plt.subplots(figsize=(9, 4.2))
    ax.bar(counts.index, counts.values,
           color="#5a89c2", edgecolor="white", linewidth=1.5)
    for x, y in zip(counts.index, counts.values):
        ax.text(x, y + 8, str(int(y)), ha="center", va="bottom",
                fontsize=10, color="#234", fontweight="bold")
    ax.set_xlabel("Seated players")
    ax.set_ylabel("Hands")
    ax.set_xticks(range(2, 10))
    ax.set_title(f"Hand counts by seat count (n = {len(df)})")
    ax.grid(alpha=0.3, axis="y")
    ax.set_ylim(0, max(counts.values) * 1.12)
    fig.tight_layout()
    fig.savefig(OUT / "fig-seat-counts.png", dpi=150)


def fig_by_table(df: pd.DataFrame, per_table: pd.DataFrame) -> None:
    """Per-table boxplot of pot sizes (log axis)."""
    n_tables = df.table_id.nunique()
    ordered = per_table.sort_values("n_hands", ascending=False)
    labels = ordered.table_label.tolist()
    boxdata = [df[df.table_id == ordered.index[i]].pot_bb.values
               for i in range(n_tables)]

    fig, ax = plt.subplots(figsize=(9, 4.5))
    bp = ax.boxplot(boxdata, labels=labels, vert=True,
                    patch_artist=True, showfliers=False)
    for patch in bp["boxes"]:
        patch.set_facecolor("#ace")
        patch.set_alpha(0.7)
    ax.set_yscale("log")
    ax.set_ylabel("Pot size (BB, log scale)")
    ax.set_title("Pot size distribution by table (log scale)")
    ax.grid(alpha=0.3, axis="y")
    plt.setp(ax.get_xticklabels(), rotation=15, ha="right")
    fig.tight_layout()
    fig.savefig(OUT / "fig-by-table.png", dpi=150)


def fig_scatter_linear(df: pd.DataFrame, lin_iid) -> None:
    """Linear-Y scatter, clipped at 1200 BB so structure is visible."""
    n = len(df)
    jitter = RNG.uniform(-0.18, 0.18, n)
    xs = np.linspace(df.num_seats.min(), df.num_seats.max(), 100)
    bin_mean = df.groupby("num_seats").pot_bb.mean()
    pred = lin_iid.get_prediction(pd.DataFrame({"num_seats": xs})).summary_frame()

    fig, ax = plt.subplots(figsize=(9, 5.5))
    ax.scatter(df.num_seats + jitter, df.pot_bb,
               alpha=0.10, s=14, color="#444", linewidth=0)
    ax.scatter(bin_mean.index, bin_mean.values,
               color="#0a4", s=110, zorder=5, edgecolor="white",
               linewidth=1.8, label="bin mean")
    ax.plot(xs, pred["mean"], color="#c33", linewidth=2.2,
            label=f"raw OLS line (would-be fit): pot = "
                  f"{lin_iid.params['Intercept']:.1f} + "
                  f"{lin_iid.params['num_seats']:.2f}·seats")
    for k, m in bin_mean.items():
        ax.annotate(f"{m:.0f}", (k, m), xytext=(0, 8),
                    textcoords="offset points", ha="center",
                    fontsize=9, color="#063")
    ax.set_xlabel("Seated players")
    ax.set_ylabel("Voluntary pot contribution (BB)")
    ax.set_ylim(0, 1200)
    ax.set_xticks(range(2, 10))
    ax.set_title("Pot size versus seat count, linear-Y scale "
                 "(Y-axis clipped at 1200 BB)")
    ax.legend(loc="upper left")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT / "fig-scatter-linear.png", dpi=150)


def fig_scatter_log(df: pd.DataFrame, lin_log) -> None:
    """Log-Y scatter with the log-linear fit."""
    n = len(df)
    jitter = RNG.uniform(-0.18, 0.18, n)
    xs = np.linspace(df.num_seats.min(), df.num_seats.max(), 100)
    bin_geo = np.exp(df.groupby("num_seats").log_pot.mean())
    pred = lin_log.get_prediction(pd.DataFrame({"num_seats": xs})).summary_frame()

    fig, ax = plt.subplots(figsize=(9, 5.5))
    ax.scatter(df.num_seats + jitter, df.pot_bb,
               alpha=0.10, s=14, color="#444", linewidth=0)
    ax.scatter(bin_geo.index, bin_geo.values,
               color="#0a4", s=110, zorder=5, edgecolor="white",
               linewidth=1.8,
               label="bin geometric mean = e^(mean log-pot)")
    ax.plot(xs, np.exp(pred["mean"]), color="#c33", linewidth=2.2,
            label=f"log-linear OLS fit: log(pot) = "
                  f"{lin_log.params['Intercept']:.2f} + "
                  f"{lin_log.params['num_seats']:.3f}·seats")
    ax.fill_between(xs,
                    np.exp(pred["mean_ci_lower"]),
                    np.exp(pred["mean_ci_upper"]),
                    color="#c33", alpha=0.15, label="95% CI band (iid)")
    for k, m in bin_geo.items():
        ax.annotate(f"{m:.0f}", (k, m), xytext=(0, 8),
                    textcoords="offset points", ha="center",
                    fontsize=9, color="#063")
    ax.set_xlabel("Seated players")
    ax.set_ylabel("Voluntary pot contribution (BB, log scale)")
    ax.set_yscale("log")
    ax.set_xticks(range(2, 10))
    ax.set_title("Pot size versus seat count, log-Y scale, "
                 "with log-linear OLS fit and 95% CI band")
    ax.legend(loc="upper left")
    ax.grid(alpha=0.3, which="both")
    fig.tight_layout()
    fig.savefig(OUT / "fig-scatter-log.png", dpi=150)


def fig_chi_square(ct: pd.DataFrame, chi_exp, chi2, chi_p, chi_dof,
                   cramers_v) -> None:
    """3-panel heatmap: observed | expected | per-cell contributions."""
    contrib = (ct.to_numpy() - chi_exp) ** 2 / chi_exp
    panels = [
        ("Observed counts",         ct.to_numpy(), "Blues",  "{:.0f}"),
        ("Expected counts (R·C/N)", chi_exp,       "Greens", "{:.1f}"),
        ("Per-cell (O − E)² / E",   contrib,       "Reds",   "{:.2f}"),
    ]
    seat_lbls = ["HU/3", "4-5", "6-max", "Full ring"]
    pot_lbls = ["tiny", "small", "medium", "big"]

    fig, axes = plt.subplots(1, 3, figsize=(14, 4.4))
    for ax, (title, mat, cmap, fmt) in zip(axes, panels):
        im = ax.imshow(mat, cmap=cmap, aspect="auto")
        ax.set_xticks(range(len(pot_lbls)))
        ax.set_xticklabels(pot_lbls)
        ax.set_yticks(range(len(seat_lbls)))
        ax.set_yticklabels(seat_lbls)
        ax.set_xlabel("pot tier")
        if title.startswith("Observed"):
            ax.set_ylabel("seats tier")
        ax.set_title(title)
        vmax = mat.max()
        for i in range(mat.shape[0]):
            for j in range(mat.shape[1]):
                v = mat[i, j]
                color = "white" if v > 0.55 * vmax else "#222"
                ax.text(j, i, fmt.format(v), ha="center", va="center",
                        color=color, fontsize=10)
        plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.suptitle(f"Chi-square test: χ² = {chi2:.2f}, df = {chi_dof}, "
                 f"p ≈ {chi_p:.1e}, Cramer's V = {cramers_v:.3f}",
                 fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(OUT / "fig-chi-square.png", dpi=150)


def fig_within_bin_sd(df: pd.DataFrame) -> None:
    """Per-seat within-bin SD of log(pot) for the equal-variance check."""
    sd = df.groupby("num_seats").log_pot.std().sort_index()
    fig, ax = plt.subplots(figsize=(9, 4.2))
    ax.bar(sd.index, sd.values,
           color="#c8a149", edgecolor="white", linewidth=1.5)
    for x, y in zip(sd.index, sd.values):
        ax.text(x, y + 0.04, f"{y:.2f}", ha="center", va="bottom",
                fontsize=10, color="#5a3", fontweight="bold")
    ax.axhline(sd.min(), color="#666", linestyle="--", linewidth=1,
               label=f"min SD = {sd.min():.2f}")
    ax.axhline(2 * sd.min(), color="red", linestyle="--", linewidth=1,
               label=f"2× min SD = {2*sd.min():.2f} (rule-of-thumb ceiling)")
    ax.set_xlabel("Seated players")
    ax.set_ylabel("Within-bin SD of log(pot)")
    ax.set_xticks(range(2, 10))
    ax.set_ylim(0, max(sd.values) * 1.18)
    ax.set_title("Within-seat standard deviation of log(pot) "
                 "(equal-variance diagnostic)")
    ax.legend(loc="upper right")
    ax.grid(alpha=0.3, axis="y")
    fig.tight_layout()
    fig.savefig(OUT / "fig-within-bin-sd.png", dpi=150)


def fig_bin_means_log(df: pd.DataFrame, lin_log) -> None:
    """Heart of Test C: actual vs linear-predicted log-mean by seat."""
    mean_log = df.groupby("num_seats").log_pot.mean().sort_index()
    seats = mean_log.index.to_numpy()
    pred = lin_log.params["Intercept"] + lin_log.params["num_seats"] * seats
    gap = mean_log.values - pred

    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 4.7),
                                    gridspec_kw={"width_ratios": [1, 1]})
    # Left: actual vs predicted
    axL.plot(seats, mean_log.values, "o-", color="#0a4", markersize=10,
             linewidth=2, label="actual mean log-pot")
    axL.plot(seats, pred, "s--", color="#c33", markersize=9,
             linewidth=2, label="linear prediction (Test B fit)")
    for s, m, p in zip(seats, mean_log.values, pred):
        axL.annotate("", xy=(s, m), xytext=(s, p),
                     arrowprops=dict(arrowstyle="-", color="#888",
                                     linestyle=":", linewidth=1))
    axL.set_xlabel("Seated players")
    axL.set_ylabel("Mean log(pot)")
    axL.set_xticks(range(2, 10))
    axL.set_title("Mean log(pot) per seat count, with linear-on-log prediction")
    axL.legend(loc="upper left")
    axL.grid(alpha=0.3)

    # Right: signed gap
    colors = ["#c33" if g > 0 else "#36c" for g in gap]
    axR.bar(seats, gap, color=colors, edgecolor="white", linewidth=1.5)
    for s, g in zip(seats, gap):
        axR.text(s, g + (0.03 if g >= 0 else -0.07), f"{g:+.2f}",
                 ha="center", va="bottom" if g >= 0 else "top",
                 fontsize=10, fontweight="bold", color="#222")
    axR.axhline(0, color="black", linewidth=0.8)
    axR.set_xlabel("Seated players")
    axR.set_ylabel("actual − predicted (log units)")
    axR.set_xticks(range(2, 10))
    axR.set_title("Per-bin residual: actual mean log(pot) minus linear prediction")
    axR.grid(alpha=0.3, axis="y")

    fig.suptitle("Lack-of-fit F-test: F = 8.158, df = (6, 1230), p ≈ 1.14×10⁻⁸", fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(OUT / "fig-bin-means-log.png", dpi=150)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    hands, actions = load_bundle(DATA_ZIP)
    df = build_dataset(hands, actions)
    per_table = descriptive_summary(df)

    # Raw OLS: fit but DO NOT report inference (LINER fails on raw scale).
    # We only use the fit to draw the would-be OLS line on fig-scatter-linear.
    lin_iid = smf.ols("pot_bb ~ num_seats", data=df).fit()

    ct, chi_exp, chi2, chi_p, chi_dof, cramers_v = test_a_chi_square(df)
    lin_log = test_b_log_linear(df)
    sat_log, lof_table = test_c_lack_of_fit(df, lin_log)

    fig_hist(df)
    fig_seat_counts(df)
    fig_by_table(df, per_table)
    fig_scatter_linear(df, lin_iid)
    fig_scatter_log(df, lin_log)
    fig_chi_square(ct, chi_exp, chi2, chi_p, chi_dof, cramers_v)
    fig_within_bin_sd(df)
    fig_bin_means_log(df, lin_log)

    print("All figures written to:", OUT)


if __name__ == "__main__":
    main()
