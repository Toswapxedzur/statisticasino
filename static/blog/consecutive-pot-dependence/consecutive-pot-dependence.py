#!/usr/bin/env python3
"""
Consecutive pot dependence — full analysis pipeline.

Reproduces every numerical result and figure used in the blog post
"Are consecutive pots independent? A LINER-checked walk through three
tests on within-table lag-1 pairs":

    https://www.sinostatistica.net/blog/consecutive-pot-dependence

Tests run, in order:
    A.  Chi-square test of independence on a 4 x 4 contingency table
        of (lag pot quartile, current pot quartile).
    B.  OLS slope t-test on log(pot_t) ~ log(pot_{t-1}) with a
        table fixed effect, using cluster-robust SE by table.
    C.  Lack-of-fit F-test on the log scale: linear vs lag-decile
        saturated, both with table FE.

A short Ljung-Box coda asks whether dependence reaches beyond lag 1.

A would-be Test 0 (raw Pearson r on raw pots) is computed only for
the LINER diagnostic and is not reported as inference.

Inputs:   consecutive-pot-data.zip (CSV bundle exported from
          /data/export-csv on statisticasino, restricted to the
          1/2 NL Hold'em tables).
Outputs:  fig-*.png in the same directory and stdout summary.

Run:      python3 consecutive-pot-dependence.py
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
from scipy.stats import chi2_contingency, pearsonr, spearmanr
from scipy.stats import chi2 as chi2_dist

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
DATA_ZIP = HERE / "consecutive-pot-data.zip"
OUT = HERE
BB = 2                              # 1/2 NL: big blind = 2 chips
RNG = np.random.default_rng(20260524)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_bundle(zip_path: Path):
    zf = zipfile.ZipFile(zip_path)

    def _read(name):
        member = next(n for n in zf.namelist() if n.endswith(name))
        return pd.read_csv(io.BytesIO(zf.read(member)))

    return _read("hands.csv"), _read("actions.csv")


def build_pairs(hands: pd.DataFrame, actions: pd.DataFrame) -> pd.DataFrame:
    """Build the consecutive-pair dataset: one row per within-table lag-1 pair.

    Filters:
        - Only 1/2 NL Hold'em tables (defensive check on table_name).
        - Drops the first hand of each table (no predecessor).
        - 2 <= num_seats <= 9 on both hand and predecessor.
    """
    voluntary = (actions
                 .query("action in ['bet','call','raise','allIn'] and chips > 0")
                 .groupby("hand_key")["chips"].sum()
                 .rename("pot_chips"))
    df = (hands.set_index("hand_key").join(voluntary, how="inner")
                .assign(pot_bb=lambda d: d.pot_chips / BB)
                .query("pot_bb > 0 and 2 <= num_seats <= 9")
                .loc[lambda d: d.table_name.str.contains(" 1/2 ")]
                .reset_index()
                .sort_values(["table_id", "first_ts"])
                .reset_index(drop=True))
    df["log_pot"] = np.log(df.pot_bb)

    g = df.groupby("table_id", sort=False)
    df["pot_lag"] = g["pot_bb"].shift(1)
    df["log_pot_lag"] = g["log_pot"].shift(1)
    df["seats_lag"] = g["num_seats"].shift(1)
    df["dt_ms"] = g["first_ts"].diff()
    pairs = df.dropna(subset=["pot_lag"]).reset_index(drop=True)
    pairs["table_id"] = pairs["table_id"].astype("category")
    return pairs


# ---------------------------------------------------------------------------
# Descriptive summary
# ---------------------------------------------------------------------------

def descriptive_summary(pairs: pd.DataFrame) -> pd.DataFrame:
    print(f"n pairs                : {len(pairs)}")
    print(f"n distinct tables      : {pairs.table_id.nunique()}")
    print(f"pairs per table        : "
          f"{dict(pairs.table_id.value_counts())}")
    print(f"median dt between hands: {pairs.dt_ms.median()/1000:.1f} s")
    print(f"95th pct dt            : {pairs.dt_ms.quantile(.95)/1000:.1f} s")
    print(f"current pot quartiles  : "
          f"{pairs.pot_bb.quantile([.25,.5,.75]).round(1).to_list()}\n")

    per_table = (pairs.groupby("table_id", observed=True)
                       .agg(n_pairs=("pot_bb", "size"),
                            r1=("pot_bb",
                                lambda v: pearsonr(v, pairs.loc[v.index,
                                                   "pot_lag"])[0]),
                            r1_log=("log_pot",
                                    lambda v: pearsonr(v, pairs.loc[v.index,
                                                       "log_pot_lag"])[0]),
                            spearman=("log_pot",
                                      lambda v: spearmanr(v,
                                                          pairs.loc[v.index,
                                                          "log_pot_lag"])[0])))
    per_table["table_label"] = (pairs.groupby("table_id", observed=True)
                                      .first().table_name
                                      .str.replace("Low Stakes - ", "")
                                      .str.replace(" - 1/2 - NL Holdem", ""))
    print("=== Per-table summary (lag-1 correlations) ===")
    print(per_table.round(4).to_string(), "\n")
    return per_table


# ---------------------------------------------------------------------------
# Test A — Chi-square test of independence
# ---------------------------------------------------------------------------

def test_a_chi_square(pairs: pd.DataFrame):
    q = pairs.pot_bb.quantile([.25, .5, .75]).values
    cats = ["tiny", "small", "medium", "big"]
    pairs["pot_cat"] = pd.cut(pairs.pot_bb,
                              bins=[-np.inf, *q, np.inf], labels=cats)
    pairs["lag_cat"] = pd.cut(pairs.pot_lag,
                              bins=[-np.inf, *q, np.inf], labels=cats)
    ct = pd.crosstab(pairs.lag_cat, pairs.pot_cat)
    chi2, p, dof, exp = chi2_contingency(ct)
    cramers_v = np.sqrt(chi2 / (len(pairs) * (min(ct.shape) - 1)))

    print("=== Test A: Chi-square test of independence ===")
    print("Observed counts (rows = lag quartile, cols = current quartile):")
    print(ct.to_string())
    print(f"\n  χ² = {chi2:.3f}, df = {dof}, p = {p:.3g}")
    print(f"  Cramer's V = {cramers_v:.4f}\n")
    return ct, exp, chi2, p, dof, cramers_v


# ---------------------------------------------------------------------------
# Test B — Log-OLS with table FE, cluster-robust SE
# ---------------------------------------------------------------------------

def test_b_log_ols_fe(pairs: pd.DataFrame):
    fit = smf.ols("log_pot ~ log_pot_lag + C(table_id)", data=pairs)\
             .fit(cov_type="cluster",
                  cov_kwds={"groups": pairs.table_id})
    b1 = fit.params["log_pot_lag"]
    se = fit.bse["log_pot_lag"]
    ci = fit.conf_int().loc["log_pot_lag"].to_list()

    print("=== Test B: log(pot_t) ~ log(pot_{t-1}) + C(table_id) ===")
    print("    cluster-robust SE by table_id\n")
    print(f"  β̂ (log_pot_lag) = {b1:.4f}")
    print(f"  cluster SE       = {se:.4f}")
    print(f"  t                = {fit.tvalues['log_pot_lag']:.3f}")
    print(f"  p                = {fit.pvalues['log_pot_lag']:.3g}")
    print(f"  95% CI           = [{ci[0]:.4f}, {ci[1]:.4f}]")
    print(f"  R²               = {fit.rsquared:.4f}")
    print(f"  R² (within-table)= {fit.rsquared - r2_table_only(pairs):.4f}\n")
    return fit


def r2_table_only(pairs: pd.DataFrame) -> float:
    return smf.ols("log_pot ~ C(table_id)", data=pairs).fit().rsquared


# ---------------------------------------------------------------------------
# Test C — Lack-of-fit F-test on log scale
# ---------------------------------------------------------------------------

def test_c_lack_of_fit(pairs: pd.DataFrame, lin_fit) -> tuple:
    pairs["lag_dec"] = pd.qcut(pairs.log_pot_lag, 10,
                                duplicates="drop").cat.codes
    sat = smf.ols("log_pot ~ C(lag_dec) + C(table_id)", data=pairs).fit()
    SSE_lin = lin_fit.ssr
    SSE_sat = sat.ssr
    df_lin = lin_fit.df_resid
    df_sat = sat.df_resid
    df_diff = df_lin - df_sat
    F = ((SSE_lin - SSE_sat) / df_diff) / (SSE_sat / df_sat)
    from scipy.stats import f as f_dist
    p_F = 1 - f_dist.cdf(F, df_diff, df_sat)

    print("=== Test C: Lack-of-fit F-test (log scale) ===")
    print(f"  SSE_lin = {SSE_lin:.4f}, df_lin = {df_lin}")
    print(f"  SSE_sat = {SSE_sat:.4f}, df_sat = {df_sat}")
    print(f"  df_diff = {df_diff}")
    print(f"  F       = {F:.4f}")
    print(f"  p       = {p_F:.4g}\n")
    return sat, F, df_diff, df_sat, p_F


# ---------------------------------------------------------------------------
# Coda — Ljung-Box at lags 1..5 on residual log-pot
# ---------------------------------------------------------------------------

def coda_ljung_box(pairs: pd.DataFrame, max_lag: int = 5):
    """Compute autocorrelation of within-table residuals up to max_lag,
    then aggregate Ljung-Box Q across lags.

    Residuals are taken after a table-FE-only fit (i.e. each pot is
    centred on its own table mean). This makes Ljung-Box answer the
    direct question 'is the within-table series independent?', and
    keeps r_1 comparable to the cluster-robust slope in Test B.
    """
    table_only = smf.ols("log_pot ~ C(table_id)", data=pairs).fit()
    resid_full = (pairs.log_pot.values - table_only.predict(pairs).values)
    table_codes = pairs.table_id.cat.codes.to_numpy()

    rk = np.zeros(max_lag)
    for k in range(1, max_lag + 1):
        num = den = 0.0
        for t in np.unique(table_codes):
            mask = table_codes == t
            r = resid_full[mask] - resid_full[mask].mean()
            if len(r) <= k:
                continue
            num += (r[k:] * r[:-k]).sum()
            den += (r * r).sum() * (len(r) - k) / max(len(r), 1)
        rk[k-1] = num / den if den > 0 else 0

    n_eff = len(resid_full)
    q_terms = (rk ** 2) / (n_eff - np.arange(1, max_lag + 1))
    Q = n_eff * (n_eff + 2) * q_terms.cumsum()
    p_Q = [1 - chi2_dist.cdf(Q[k], k + 1) for k in range(max_lag)]

    print("=== Coda: Ljung-Box on within-table residuals ===")
    print(f"  lag | r_k    | cumulative Q  | df | p")
    for k in range(max_lag):
        print(f"   {k+1:3d}  | {rk[k]:+.4f} | {Q[k]:8.3f}     | "
              f"{k+1:2d} | {p_Q[k]:.4g}")
    print()
    return rk, Q, p_Q


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

def fig_lag_scatter_linear(pairs: pd.DataFrame) -> None:
    """Linear-scale lag scatter, clipped, showing why we won't run raw r."""
    fig, ax = plt.subplots(figsize=(8.5, 5.5))
    ax.scatter(pairs.pot_lag, pairs.pot_bb,
               alpha=0.18, s=14, color="#444", linewidth=0)
    cap = 1500
    ax.set_xlim(0, cap)
    ax.set_ylim(0, cap)
    lin = np.linspace(0, cap, 100)
    ax.plot(lin, lin, color="#999", linestyle="--", linewidth=1,
            label="y = x reference")
    fit = sm.OLS(pairs.pot_bb, sm.add_constant(pairs.pot_lag)).fit()
    ax.plot(lin, fit.params.iloc[0] + fit.params.iloc[1] * lin,
            color="#c33", linewidth=2,
            label=f"OLS (would-be): pot_t = "
                  f"{fit.params.iloc[0]:.0f} + {fit.params.iloc[1]:.3f}·pot_(t-1)")
    ax.set_xlabel("Previous-hand pot (BB)")
    ax.set_ylabel("Current-hand pot (BB)")
    ax.set_title("Lag-1 pot pairs, linear scale (clipped at 1500 BB)")
    ax.legend(loc="upper left")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(OUT / "fig-lag-scatter-linear.png", dpi=150)


def fig_lag_scatter_log(pairs: pd.DataFrame, lin_fit) -> None:
    """Log-log lag scatter with regression line and cluster CI band."""
    x = pairs.log_pot_lag
    y = pairs.log_pot
    xs = np.linspace(x.min(), x.max(), 100)

    new = pd.DataFrame({"log_pot_lag": xs,
                        "table_id": pairs.table_id.iloc[0]})
    pred = lin_fit.get_prediction(new).summary_frame()
    centering = pred["mean"].iloc[0] - (
        lin_fit.params["log_pot_lag"] * xs[0])
    yhat = lin_fit.params["log_pot_lag"] * xs + centering

    fig, ax = plt.subplots(figsize=(8.5, 5.5))
    ax.scatter(np.exp(x), np.exp(y), alpha=0.18, s=14,
               color="#444", linewidth=0)
    ax.plot(np.exp(xs), np.exp(yhat),
            color="#c33", linewidth=2.2,
            label=f"OLS slope on log scale: β̂ = "
                  f"{lin_fit.params['log_pot_lag']:.3f}")
    half_ci = lin_fit.bse["log_pot_lag"] * 1.96
    ax.fill_between(np.exp(xs),
                    np.exp(yhat - half_ci * (xs - xs.mean())),
                    np.exp(yhat + half_ci * (xs - xs.mean())),
                    color="#c33", alpha=0.13,
                    label="95% slope CI band (cluster-robust)")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("Previous-hand pot (BB, log)")
    ax.set_ylabel("Current-hand pot (BB, log)")
    ax.set_title("Lag-1 pot pairs, log-log scale, with OLS fit and "
                 "cluster-robust 95% CI band")
    ax.legend(loc="upper left")
    ax.grid(alpha=0.3, which="both")
    fig.tight_layout()
    fig.savefig(OUT / "fig-lag-scatter-log.png", dpi=150)


def fig_chi_square(ct, chi_exp, chi2, chi_p, chi_dof, cramers_v) -> None:
    contrib = (ct.to_numpy() - chi_exp) ** 2 / chi_exp
    panels = [
        ("Observed counts", ct.to_numpy(), "Blues", "{:.0f}"),
        ("Expected counts (R·C/N)", chi_exp, "Greens", "{:.1f}"),
        ("Per-cell (O − E)² / E", contrib, "Reds", "{:.2f}"),
    ]
    labels = ["tiny", "small", "medium", "big"]

    fig, axes = plt.subplots(1, 3, figsize=(14, 4.4))
    for ax, (title, mat, cmap, fmt) in zip(axes, panels):
        im = ax.imshow(mat, cmap=cmap, aspect="auto")
        ax.set_xticks(range(4))
        ax.set_xticklabels(labels)
        ax.set_yticks(range(4))
        ax.set_yticklabels(labels)
        ax.set_xlabel("Current-hand pot tier")
        if title.startswith("Observed"):
            ax.set_ylabel("Previous-hand pot tier")
        ax.set_title(title)
        vmax = mat.max()
        for i in range(mat.shape[0]):
            for j in range(mat.shape[1]):
                v = mat[i, j]
                color = "white" if v > 0.55 * vmax else "#222"
                ax.text(j, i, fmt.format(v), ha="center", va="center",
                        color=color, fontsize=10)
        plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.suptitle(f"Chi-square test of independence: χ² = {chi2:.2f}, "
                 f"df = {chi_dof}, p ≈ {chi_p:.1e}, "
                 f"Cramer's V = {cramers_v:.3f}",
                 fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(OUT / "fig-chi-square.png", dpi=150)


def fig_per_table_correlation(per_table: pd.DataFrame) -> None:
    """Forest plot of within-table lag-1 log correlations."""
    pt = per_table.sort_values("r1_log")
    n = len(pt)
    se = 1.0 / np.sqrt(pt.n_pairs - 3)         # Fisher-z SE
    z = np.arctanh(pt.r1_log.clip(-0.9999, 0.9999))
    lo = np.tanh(z - 1.96 * se)
    hi = np.tanh(z + 1.96 * se)

    fig, ax = plt.subplots(figsize=(10.5, 4.2))
    y_pos = np.arange(n)
    ax.errorbar(pt.r1_log, y_pos,
                xerr=[pt.r1_log - lo, hi - pt.r1_log],
                fmt="o", color="#3a6", ecolor="#3a6", capsize=4,
                markersize=8)
    x_max = float(hi.max())
    label_x = x_max + 0.05
    for i, (lbl, r, n_p) in enumerate(zip(pt.table_label,
                                          pt.r1_log, pt.n_pairs)):
        ax.text(label_x, i,
                f"r = {r:+.3f}  (n = {n_p})",
                ha="left", va="center", fontsize=9, color="#333")
    ax.set_xlim(min(0, lo.min() - 0.05), label_x + 0.20)
    ax.axvline(0, color="black", linewidth=0.7)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(pt.table_label)
    ax.set_xlabel("Pearson r between log(pot_t) and log(pot_{t-1})")
    ax.set_title("Per-table lag-1 correlation on log scale, "
                 "with Fisher-z 95% CI")
    ax.grid(alpha=0.3, axis="x")
    fig.tight_layout()
    fig.savefig(OUT / "fig-per-table-correlation.png", dpi=150)


def fig_acf(pairs: pd.DataFrame, max_lag: int = 10) -> None:
    """ACF of within-table log-pot residuals (table FE only), with Bartlett band."""
    table_only = smf.ols("log_pot ~ C(table_id)", data=pairs).fit()
    resid = (pairs.log_pot.values - table_only.predict(pairs).values)
    table_codes = pairs.table_id.cat.codes.to_numpy()

    rk = np.zeros(max_lag)
    for k in range(1, max_lag + 1):
        num = den = 0.0
        cnt = 0
        for t in np.unique(table_codes):
            mask = table_codes == t
            r = resid[mask] - resid[mask].mean()
            if len(r) <= k:
                continue
            num += (r[k:] * r[:-k]).sum()
            den += (r * r).sum() * (len(r) - k) / max(len(r), 1)
            cnt += 1
        rk[k-1] = num / den if den > 0 else 0
    bartlett = 1.96 / np.sqrt(len(pairs))

    fig, ax = plt.subplots(figsize=(9, 4))
    ax.bar(range(1, max_lag + 1), rk,
           color="#5a89c2", edgecolor="white", linewidth=1.5)
    ax.axhspan(-bartlett, bartlett, color="#aaa", alpha=0.25,
               label="Bartlett ±2/√n band (under independence)")
    ax.axhline(0, color="black", linewidth=0.6)
    for k, v in enumerate(rk, start=1):
        ax.text(k, v + (0.005 if v >= 0 else -0.012),
                f"{v:+.3f}", ha="center",
                va="bottom" if v >= 0 else "top",
                fontsize=9, color="#222")
    ax.set_xlabel("Lag (hands)")
    ax.set_ylabel("Autocorrelation r_k")
    ax.set_xticks(range(1, max_lag + 1))
    ax.set_title("Autocorrelation of within-table log-pot residuals, "
                 "lags 1–10, with Bartlett 95% white-noise band")
    ax.legend(loc="upper right")
    ax.grid(alpha=0.3, axis="y")
    fig.tight_layout()
    fig.savefig(OUT / "fig-acf.png", dpi=150)


def fig_bin_means_log(pairs: pd.DataFrame, lin_fit) -> None:
    """Bin means: actual vs linear-predicted log-pot per lag decile,
    after table-FE residualisation so the comparison is apples-to-apples
    with the F-test (which absorbs table FE)."""
    pairs = pairs.copy()
    pairs["lag_dec"] = pd.qcut(pairs.log_pot_lag, 10,
                                duplicates="drop").cat.codes
    table_only = smf.ols("log_pot ~ C(table_id)", data=pairs).fit()
    res_y = pairs.log_pot.values - table_only.predict(pairs).values
    res_x_fit = smf.ols("log_pot_lag ~ C(table_id)", data=pairs).fit()
    res_x = pairs.log_pot_lag.values - res_x_fit.predict(pairs).values
    pairs["res_y"] = res_y
    pairs["res_x"] = res_x
    grp = pairs.groupby("lag_dec", observed=True)
    actual = grp.res_y.mean()
    lag_mid = grp.res_x.mean()
    beta_w = lin_fit.params["log_pot_lag"]
    pred_centered = beta_w * lag_mid
    gap = actual - pred_centered

    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 4.7),
                                    gridspec_kw={"width_ratios": [1, 1]})
    axL.plot(lag_mid, actual, "o-", color="#0a4", markersize=10,
             linewidth=2,
             label="actual mean residual log-pot per lag-residual decile")
    axL.plot(lag_mid, pred_centered, "s--", color="#c33", markersize=9,
             linewidth=2, label=f"linear prediction (β̂ = {beta_w:.3f})")
    for s, m, p in zip(lag_mid, actual, pred_centered):
        axL.annotate("", xy=(s, m), xytext=(s, p),
                     arrowprops=dict(arrowstyle="-", color="#888",
                                     linestyle=":", linewidth=1))
    axL.axhline(0, color="black", linewidth=0.5)
    axL.set_xlabel("Mean (lag log-pot − table mean) within decile")
    axL.set_ylabel("Mean (current log-pot − table mean)")
    axL.set_title("Within-table residualized: actual decile means vs linear prediction")
    axL.legend(loc="upper left")
    axL.grid(alpha=0.3)

    colors = ["#c33" if g > 0 else "#36c" for g in gap]
    axR.bar(range(len(gap)), gap, color=colors,
            edgecolor="white", linewidth=1.5)
    for i, g in enumerate(gap):
        axR.text(i, g + (0.01 if g >= 0 else -0.02), f"{g:+.2f}",
                 ha="center", va="bottom" if g >= 0 else "top",
                 fontsize=9, fontweight="bold", color="#222")
    axR.axhline(0, color="black", linewidth=0.8)
    axR.set_xlabel("Lag-pot decile (low → high)")
    axR.set_ylabel("actual − predicted (log units)")
    axR.set_xticks(range(len(gap)))
    axR.set_title("Per-decile residual gap (actual minus linear prediction)")
    axR.grid(alpha=0.3, axis="y")

    fig.suptitle("Lack-of-fit F-test: per-decile fit diagnostic",
                 fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(OUT / "fig-bin-means-log.png", dpi=150)


def fig_within_decile_sd(pairs: pd.DataFrame) -> None:
    pairs = pairs.copy()
    pairs["lag_dec"] = pd.qcut(pairs.log_pot_lag, 10,
                                duplicates="drop").cat.codes
    sd = pairs.groupby("lag_dec", observed=True).log_pot.std()
    fig, ax = plt.subplots(figsize=(9, 4.2))
    ax.bar(sd.index, sd.values,
           color="#c8a149", edgecolor="white", linewidth=1.5)
    for x, y in zip(sd.index, sd.values):
        ax.text(x, y + 0.02, f"{y:.2f}", ha="center", va="bottom",
                fontsize=9, color="#5a3", fontweight="bold")
    ax.axhline(sd.min(), color="#666", linestyle="--", linewidth=1,
               label=f"min SD = {sd.min():.2f}")
    ax.axhline(2 * sd.min(), color="red", linestyle="--", linewidth=1,
               label=f"2× min SD = {2*sd.min():.2f}")
    ax.set_xlabel("Lag-pot decile")
    ax.set_ylabel("Within-decile SD of log(pot_t)")
    ax.set_title("Within-decile standard deviation of log(pot_t) "
                 "(equal-variance diagnostic)")
    ax.legend(loc="upper right")
    ax.grid(alpha=0.3, axis="y")
    fig.tight_layout()
    fig.savefig(OUT / "fig-within-decile-sd.png", dpi=150)


def fig_ljung_box(rk: np.ndarray, Q: np.ndarray, p_Q: list) -> None:
    max_lag = len(rk)
    fig, (axL, axR) = plt.subplots(1, 2, figsize=(13, 4.4))

    axL.bar(range(1, max_lag + 1), rk,
            color="#5a89c2", edgecolor="white", linewidth=1.5)
    axL.axhline(0, color="black", linewidth=0.6)
    for k, v in enumerate(rk, start=1):
        axL.text(k, v + (0.005 if v >= 0 else -0.012),
                 f"{v:+.3f}", ha="center",
                 va="bottom" if v >= 0 else "top",
                 fontsize=9, color="#222")
    axL.set_xlabel("Lag k")
    axL.set_ylabel("Within-table residual autocorrelation r_k")
    axL.set_xticks(range(1, max_lag + 1))
    axL.set_title("Within-table residual autocorrelation, lags 1–5")
    axL.grid(alpha=0.3, axis="y")

    crit = [chi2_dist.ppf(0.95, k) for k in range(1, max_lag + 1)]
    axR.bar(range(1, max_lag + 1), Q,
            color="#c8a149", edgecolor="white", linewidth=1.5,
            label="cumulative Ljung-Box Q")
    axR.plot(range(1, max_lag + 1), crit, "o--", color="#c33",
             linewidth=1.5, markersize=7, label="χ²_k 95% critical value")
    for k, (q, p) in enumerate(zip(Q, p_Q), start=1):
        axR.text(k, q + max(crit) * 0.04,
                 f"p={p:.2g}", ha="center", va="bottom",
                 fontsize=9, color="#222")
    axR.set_xlabel("k = number of lags accumulated")
    axR.set_ylabel("Ljung-Box Q")
    axR.set_xticks(range(1, max_lag + 1))
    axR.set_title("Cumulative Ljung-Box Q against χ² 95% critical value")
    axR.grid(alpha=0.3, axis="y")
    axR.legend(loc="upper left")

    fig.tight_layout()
    fig.savefig(OUT / "fig-ljung-box.png", dpi=150)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    hands, actions = load_bundle(DATA_ZIP)
    pairs = build_pairs(hands, actions)
    per_table = descriptive_summary(pairs)

    ct, exp, chi2, chi_p, dof, V = test_a_chi_square(pairs)
    fit_b = test_b_log_ols_fe(pairs)
    sat, F, df_diff, df_sat, p_F = test_c_lack_of_fit(pairs, fit_b)
    rk, Q, p_Q = coda_ljung_box(pairs)

    fig_lag_scatter_linear(pairs)
    fig_lag_scatter_log(pairs, fit_b)
    fig_chi_square(ct, exp, chi2, chi_p, dof, V)
    fig_per_table_correlation(per_table)
    fig_acf(pairs)
    fig_bin_means_log(pairs, fit_b)
    fig_within_decile_sd(pairs)
    fig_ljung_box(rk, Q, p_Q)

    print("All figures written to:", OUT)


if __name__ == "__main__":
    main()
