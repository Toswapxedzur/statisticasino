#!/usr/bin/env python3
"""
Lack-of-fit F-test introduction — full pipeline.

Companion script to the blog post
"Beyond 'is the slope significant?': An introduction to the lack-of-fit F-test"

    https://www.sinostatistica.net/blog/lack-of-fit-intro

Walks through the lack-of-fit F-test on a synthetic spring-extension
dataset: 8 distinct mass levels (100, 200, ..., 800 g), 10 replicate
measurements at each level. The "truth" used to generate the data has
a small quadratic curvature on top of an otherwise linear extension,
so the linear regression slope is highly significant but the linear
shape is itself wrong.

Outputs:
    fig-data-scatter.png       raw data + bin means + would-be OLS line
    fig-residual-plot.png      residuals vs fitted (concave pattern)
    fig-nested-models.png      linear fit vs saturated (per-bin means)
    fig-ss-decomposition.png   SSE_lin = SS_PE + SS_LoF stacked bar
    fig-f-distribution.png     F(6, 72) density with stat + critical value

Run:      python3 lack-of-fit.py
Depends:  pandas, numpy, scipy, statsmodels, matplotlib.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy.stats import f as f_dist
from scipy.stats import t as student_t

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
OUT = HERE
RNG = np.random.default_rng(20260528)

MASS_LEVELS_G = np.array([100, 200, 300, 400, 500, 600, 700, 800])
REPLICATES = 10

# True data-generating process, kept in code only (never quoted as
# "the truth" in the blog post — the student sees the data as if it
# came out of a lab):
#
#     extension_cm = 0.45*(m/100) + 0.06*(m/100)^2 + N(0, 0.18^2)
#
# At m = 100 g this is 0.45 + 0.06 = 0.51 cm.
# At m = 800 g this is 3.60 + 3.84 = 7.44 cm.
TRUE_BETA_LIN = 0.45     # cm per (100 g)
TRUE_BETA_QUAD = 0.06    # cm per (100 g)^2
NOISE_SD = 0.18          # cm


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def make_dataset() -> pd.DataFrame:
    """Generate the synthetic spring-extension dataset.

    Each row is one (mass, extension) measurement; 8 mass levels x 10
    replicates = 80 rows total.
    """
    masses = np.repeat(MASS_LEVELS_G, REPLICATES).astype(float)
    m100 = masses / 100.0
    truth = TRUE_BETA_LIN * m100 + TRUE_BETA_QUAD * m100 ** 2
    noise = RNG.normal(0.0, NOISE_SD, size=len(masses))
    extensions = truth + noise
    return pd.DataFrame({"mass_g": masses, "extension_cm": extensions})


# ---------------------------------------------------------------------------
# Test machinery
# ---------------------------------------------------------------------------

def linear_fit(df: pd.DataFrame):
    """OLS: extension_cm ~ mass_g."""
    return smf.ols("extension_cm ~ mass_g", data=df).fit()


def lack_of_fit_table(df: pd.DataFrame, lin_fit) -> pd.DataFrame:
    """Saturated-vs-linear nested-model ANOVA on the same data."""
    sat_fit = smf.ols("extension_cm ~ C(mass_g)", data=df).fit()
    return sm.stats.anova_lm(lin_fit, sat_fit), sat_fit


def summarise(df: pd.DataFrame) -> None:
    """Print every number the blog post quotes."""
    n = len(df)
    print(f"n observations             : {n}")
    print(f"distinct mass levels (k)   : {df.mass_g.nunique()}")
    print(f"replicates per level       : "
          f"{int(df.groupby('mass_g').size().min())}-"
          f"{int(df.groupby('mass_g').size().max())}")

    bin_summary = (df.groupby("mass_g")
                     .agg(n=("extension_cm", "size"),
                          mean=("extension_cm", "mean"),
                          sd=("extension_cm", "std"))
                     .round(4))
    print("\n=== Per-mass-level summary ===")
    print(bin_summary.to_string())

    lin = linear_fit(df)
    print("\n=== Linear OLS fit ===")
    print(f"  beta_0 = {lin.params['Intercept']:.6f} cm")
    print(f"  beta_1 = {lin.params['mass_g']:.6f} cm/g")
    print(f"  SE(beta_1) = {lin.bse['mass_g']:.6f}")
    print(f"  t = {lin.tvalues['mass_g']:.4f}")
    print(f"  p = {lin.pvalues['mass_g']:.3g}")
    print(f"  R^2 = {lin.rsquared:.4f}")
    print(f"  SSE_lin = {lin.ssr:.4f},  df_lin = {int(lin.df_resid)}")
    print(f"  residual SE s = {np.sqrt(lin.ssr / lin.df_resid):.4f} cm")
    tstar = student_t.ppf(0.975, lin.df_resid)
    ci_lo, ci_hi = lin.conf_int().loc["mass_g"]
    print(f"  t*(0.975, {int(lin.df_resid)}) = {tstar:.4f}")
    print(f"  95% CI on beta_1 = [{ci_lo:.6f}, {ci_hi:.6f}] cm/g")

    anova, sat = lack_of_fit_table(df, lin)
    print("\n=== Saturated OLS fit (one mean per mass level) ===")
    print(f"  SS_PE = {sat.ssr:.4f},  df_PE = {int(sat.df_resid)}")

    SSE_lin = lin.ssr
    SS_PE = sat.ssr
    df_lin = int(lin.df_resid)
    df_PE = int(sat.df_resid)
    SS_LoF = SSE_lin - SS_PE
    df_LoF = df_lin - df_PE
    MS_LoF = SS_LoF / df_LoF
    MS_PE = SS_PE / df_PE
    F = MS_LoF / MS_PE
    p_F = f_dist.sf(F, df_LoF, df_PE)
    Fcrit = f_dist.ppf(0.95, df_LoF, df_PE)

    print("\n=== Lack-of-fit F-test ===")
    print(f"  SS_LoF       = SSE_lin - SS_PE     = {SS_LoF:.4f}")
    print(f"  df_LoF       = df_lin - df_PE      = {df_LoF}")
    print(f"  MS_LoF       = SS_LoF / df_LoF     = {MS_LoF:.4f}")
    print(f"  MS_PE        = SS_PE  / df_PE      = {MS_PE:.4f}")
    print(f"  F            = MS_LoF / MS_PE      = {F:.4f}")
    print(f"  F*(0.05, {df_LoF}, {df_PE}) = {Fcrit:.4f}")
    print(f"  p(F_{df_LoF},{df_PE} > {F:.2f}) = {p_F:.3g}")

    print("\n=== statsmodels anova_lm ===")
    print(anova.round(4).to_string())


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

def fig_data_scatter(df: pd.DataFrame, lin) -> None:
    """Raw data with bin means and the would-be OLS line."""
    xs = np.linspace(MASS_LEVELS_G.min() - 20, MASS_LEVELS_G.max() + 20, 100)
    fitted = lin.params["Intercept"] + lin.params["mass_g"] * xs
    bin_mean = df.groupby("mass_g").extension_cm.mean()

    fig, ax = plt.subplots(figsize=(9, 5))
    jitter = RNG.uniform(-8, 8, len(df))
    ax.scatter(df.mass_g + jitter, df.extension_cm,
               s=24, alpha=0.45, color="#444", linewidth=0,
               label=f"raw measurements (n = {len(df)})")
    ax.scatter(bin_mean.index, bin_mean.values,
               s=120, color="#0a4", zorder=5, edgecolor="white",
               linewidth=1.8, label="per-mass mean extension")
    ax.plot(xs, fitted, color="#c33", linewidth=2.2,
            label=f"linear OLS fit: extension = "
                  f"{lin.params['Intercept']:.3f} + "
                  f"{lin.params['mass_g']:.5f} . mass")
    for m, e in bin_mean.items():
        ax.annotate(f"{e:.2f}", (m, e), xytext=(0, 9),
                    textcoords="offset points", ha="center",
                    fontsize=9, color="#063")
    ax.set_xlabel("Mass on the spring (g)")
    ax.set_ylabel("Extension below the rest length (cm)")
    ax.set_xticks(MASS_LEVELS_G)
    ax.set_title(f"Spring extension versus hung mass "
                 f"(n = {len(df)}, k = {df.mass_g.nunique()} mass levels)")
    ax.grid(alpha=0.3)
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(OUT / "fig-data-scatter.png", dpi=150)
    plt.close(fig)


def fig_residual_plot(df: pd.DataFrame, lin) -> None:
    """Residuals vs fitted, with the concave pattern made obvious."""
    fitted = lin.fittedvalues.to_numpy()
    resid = lin.resid.to_numpy()
    # Bin the residuals by mass to show the per-bin mean residual.
    bin_mean_resid = (pd.DataFrame({"mass_g": df.mass_g, "resid": resid})
                        .groupby("mass_g").resid.mean())
    bin_fitted = (lin.params["Intercept"]
                  + lin.params["mass_g"] * bin_mean_resid.index.to_numpy())

    fig, ax = plt.subplots(figsize=(9, 4.7))
    ax.axhline(0, color="black", linewidth=0.8)
    ax.scatter(fitted, resid, s=24, alpha=0.45,
               color="#444", linewidth=0, label="residuals")
    ax.plot(bin_fitted, bin_mean_resid.values, "o-",
            color="#c33", markersize=9, linewidth=2,
            label="mean residual at each mass level")
    for f_val, r_val in zip(bin_fitted, bin_mean_resid.values):
        ax.annotate(f"{r_val:+.2f}", (f_val, r_val), xytext=(0, 9),
                    textcoords="offset points", ha="center",
                    fontsize=9, color="#722")
    ax.set_xlabel("Fitted value (cm) — predicted extension from the linear fit")
    ax.set_ylabel("Residual (cm) — observed minus predicted")
    ax.set_title("Residual plot: a smile is hiding inside the noise")
    ax.grid(alpha=0.3)
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(OUT / "fig-residual-plot.png", dpi=150)
    plt.close(fig)


def fig_nested_models(df: pd.DataFrame, lin) -> None:
    """Side-by-side: linear fit vs saturated (per-bin means)."""
    bin_mean = df.groupby("mass_g").extension_cm.mean()
    bin_sd = df.groupby("mass_g").extension_cm.std()
    bin_n = df.groupby("mass_g").extension_cm.size()
    bin_se = bin_sd / np.sqrt(bin_n)

    xs = np.linspace(MASS_LEVELS_G.min() - 20, MASS_LEVELS_G.max() + 20, 100)
    fitted = lin.params["Intercept"] + lin.params["mass_g"] * xs

    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 5), sharey=True)

    jitter = RNG.uniform(-8, 8, len(df))
    axL.scatter(df.mass_g + jitter, df.extension_cm, s=20,
                alpha=0.30, color="#666", linewidth=0)
    axL.plot(xs, fitted, color="#c33", linewidth=2.2,
             label="linear model (2 parameters)")
    axL.set_title("Linear model: one line through everything")
    axL.set_xlabel("Mass (g)")
    axL.set_ylabel("Extension (cm)")
    axL.set_xticks(MASS_LEVELS_G)
    axL.grid(alpha=0.3)
    axL.legend(loc="upper left")

    axR.scatter(df.mass_g + jitter, df.extension_cm, s=20,
                alpha=0.30, color="#666", linewidth=0)
    axR.errorbar(bin_mean.index, bin_mean.values,
                 yerr=1.96 * bin_se, fmt="o-",
                 color="#06a", markersize=9, linewidth=2,
                 capsize=4, label="saturated model (8 parameters)\nbin mean +/- 2 SE")
    axR.set_title("Saturated model: one mean per mass level")
    axR.set_xlabel("Mass (g)")
    axR.set_xticks(MASS_LEVELS_G)
    axR.grid(alpha=0.3)
    axR.legend(loc="upper left")

    fig.suptitle("Two nested models: the line is restricted, "
                 "the bin-means are free",
                 fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(OUT / "fig-nested-models.png", dpi=150)
    plt.close(fig)


def fig_ss_decomposition(SSE_lin: float, SS_PE: float,
                         SS_LoF: float) -> None:
    """Stacked bar of SSE_lin = SS_PE + SS_LoF."""
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.bar(0, SS_PE, width=0.55,
           color="#06a", edgecolor="white", linewidth=1.5,
           label=f"pure error: SS_PE = {SS_PE:.4f}")
    ax.bar(0, SS_LoF, bottom=SS_PE, width=0.55,
           color="#c33", edgecolor="white", linewidth=1.5,
           label=f"lack of fit: SS_LoF = {SS_LoF:.4f}")
    ax.text(0, SS_PE / 2, f"pure error\n{SS_PE:.4f}",
            ha="center", va="center", color="white",
            fontsize=11, fontweight="bold")
    ax.text(0, SS_PE + SS_LoF / 2, f"lack of fit\n{SS_LoF:.4f}",
            ha="center", va="center", color="white",
            fontsize=11, fontweight="bold")
    ax.set_xticks([0])
    ax.set_xticklabels([f"linear-model residuals\nSSE_lin = {SSE_lin:.4f}"])
    ax.set_ylabel("Sum of squared residuals (cm$^2$)")
    ax.set_title("Decomposing SSE: line residuals = pure error + lack of fit")
    ax.set_ylim(0, SSE_lin * 1.08)
    ax.grid(alpha=0.3, axis="y")
    ax.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(OUT / "fig-ss-decomposition.png", dpi=150)
    plt.close(fig)


def fig_f_distribution(F_obs: float, df_LoF: int, df_PE: int) -> None:
    """F-density with the observed statistic and the 5% critical value."""
    Fcrit = f_dist.ppf(0.95, df_LoF, df_PE)
    # `sf` (= 1 - cdf) is numerically stable for tiny right-tail areas;
    # `1 - cdf` underflows to zero past F ~ 20 on these df.
    p = f_dist.sf(F_obs, df_LoF, df_PE)
    xmax = max(F_obs * 1.15, Fcrit * 2.0, 6.0)
    xs = np.linspace(0.01, xmax, 600)
    ys = f_dist.pdf(xs, df_LoF, df_PE)

    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.plot(xs, ys, color="#234", linewidth=2,
            label=f"F density, df = ({df_LoF}, {df_PE})")
    # 5% right tail
    tail_xs = xs[xs >= Fcrit]
    tail_ys = ys[xs >= Fcrit]
    ax.fill_between(tail_xs, 0, tail_ys, color="#c33", alpha=0.25,
                    label=f"5% right tail (F > {Fcrit:.2f})")
    ax.axvline(Fcrit, color="#c33", linestyle="--", linewidth=1.4)
    ax.axvline(F_obs, color="#0a4", linewidth=2.4,
               label=f"observed F = {F_obs:.2f}, p = {p:.2g}")
    ax.set_xlabel("F statistic")
    ax.set_ylabel("density")
    ax.set_title(f"Reference distribution: F({df_LoF}, {df_PE}). "
                 "The observed statistic sits far to the right of the 5% cutoff.")
    ax.set_xlim(0, xmax)
    ax.grid(alpha=0.3)
    ax.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(OUT / "fig-f-distribution.png", dpi=150)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    df = make_dataset()
    lin = linear_fit(df)
    _, sat = lack_of_fit_table(df, lin)

    summarise(df)

    SSE_lin = lin.ssr
    SS_PE = sat.ssr
    SS_LoF = SSE_lin - SS_PE
    df_LoF = int(lin.df_resid - sat.df_resid)
    df_PE = int(sat.df_resid)
    F_obs = (SS_LoF / df_LoF) / (SS_PE / df_PE)

    fig_data_scatter(df, lin)
    fig_residual_plot(df, lin)
    fig_nested_models(df, lin)
    fig_ss_decomposition(SSE_lin, SS_PE, SS_LoF)
    fig_f_distribution(F_obs, df_LoF, df_PE)

    print("\nAll figures written to:", OUT)


if __name__ == "__main__":
    main()
