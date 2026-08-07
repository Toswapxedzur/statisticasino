#!/usr/bin/env python3
"""
Consecutive pot dependence — arithmetic walkthrough.

Companion to consecutive-pot-dependence.py. Where the main script just
prints the high-level test outputs, this script prints every
intermediate quantity that the blog post plugs into a formula by hand:

    Test 0 (raw Pearson, dropped):  Σx, Σy, Σx², Σy², Σxy, Sxx, Syy,
                                    Sxy, r, t, p — flagged but not used.
    Test A (chi-square):            observed, row/col/N totals, expected,
                                    per-cell (O−E)²/E, χ², df, p, V.
    Test B (log OLS + table FE):    β̂, cluster-robust SE, t, CI, R².
    Test C (lack-of-fit F, log):    SSE_lin, SSE_sat, df, F, p, plus
                                    decile means.
    Companion measures:             Pearson r and Spearman ρ on the
                                    log scale.
    Coda (Ljung-Box):                lag-k autocorrelations on within-table
                                    residuals, cumulative Q, p-values.

Run:      python3 consecutive-pot-dependence-arith.py
Inputs:   consecutive-pot-data.zip (next to this script)
Depends:  pandas, numpy, scipy, statsmodels.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy.stats import chi2 as chi2_dist
from scipy.stats import f as f_dist
from scipy.stats import pearsonr, spearmanr
from scipy.stats import t as student_t

HERE = Path(__file__).parent
DATA_ZIP = HERE / "consecutive-pot-data.zip"
BB = 2


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

zf = zipfile.ZipFile(DATA_ZIP)


def _read(name: str) -> pd.DataFrame:
    member = next(n for n in zf.namelist() if n.endswith(name))
    return pd.read_csv(io.BytesIO(zf.read(member)))


hands = _read("hands.csv")
actions = _read("actions.csv")
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
pairs = df.dropna(subset=["pot_lag"]).reset_index(drop=True)
pairs["table_id"] = pairs["table_id"].astype("category")

n = len(pairs)
x_raw = pairs.pot_lag.to_numpy()
y_raw = pairs.pot_bb.to_numpy()
x = pairs.log_pot_lag.to_numpy()
y = pairs.log_pot.to_numpy()


# ===========================================================================
# Test 0 — Raw Pearson r (DROPPED: LINER fails on raw scale)
# ===========================================================================

xbar_raw = x_raw.mean()
ybar_raw = y_raw.mean()
Sxx_raw = ((x_raw - xbar_raw) ** 2).sum()
Syy_raw = ((y_raw - ybar_raw) ** 2).sum()
Sxy_raw = ((x_raw - xbar_raw) * (y_raw - ybar_raw)).sum()
r_raw = Sxy_raw / np.sqrt(Sxx_raw * Syy_raw)

print("=== Raw Pearson arithmetic (DROPPED: LINER fails on raw scale) ===")
print(f"n        = {n}")
print(f"x̄ (raw) = {xbar_raw:.4f}")
print(f"ȳ (raw) = {ybar_raw:.4f}")
print(f"Sxx_raw  = {Sxx_raw:.2f}")
print(f"Syy_raw  = {Syy_raw:.2f}")
print(f"Sxy_raw  = {Sxy_raw:.2f}")
print(f"r_raw    = Sxy / √(Sxx Syy) = {r_raw:.4f}")
print(f"        (Pearson r on raw heavy-tailed pots — descriptive only)\n")


# ===========================================================================
# Test A — Chi-square test of independence on the lag pair
# ===========================================================================

q = pairs.pot_bb.quantile([.25, .5, .75]).values
cats = ["tiny", "small", "medium", "big"]
pairs["pot_cat"] = pd.cut(pairs.pot_bb,
                          bins=[-np.inf, *q, np.inf], labels=cats)
pairs["lag_cat"] = pd.cut(pairs.pot_lag,
                          bins=[-np.inf, *q, np.inf], labels=cats)
ct = pd.crosstab(pairs.lag_cat, pairs.pot_cat)
row_tot = ct.sum(axis=1).to_numpy()
col_tot = ct.sum(axis=0).to_numpy()
N = ct.sum().sum()
exp = np.outer(row_tot, col_tot) / N
exp_df = pd.DataFrame(exp, index=ct.index, columns=ct.columns)
contrib = (ct.to_numpy() - exp) ** 2 / exp
contrib_df = pd.DataFrame(contrib, index=ct.index, columns=ct.columns)
chi2_stat = contrib.sum()
df_chi = (ct.shape[0] - 1) * (ct.shape[1] - 1)
p_chi = 1 - chi2_dist.cdf(chi2_stat, df_chi)
cramers_v = np.sqrt(chi2_stat / (N * (min(ct.shape) - 1)))

print("=== Test A: Chi-square arithmetic ===")
print(f"Pot quartile cutpoints: {q.round(2).tolist()}")
print(f"  bin labels: {cats}")
print("\nObserved counts (rows = lag tier, cols = current tier):")
print(ct.to_string())
print(f"\nRow totals: {row_tot.tolist()}")
print(f"Col totals: {col_tot.tolist()}")
print(f"Grand total N = {N}")
print(f"\nExpected counts E_ij = R_i · C_j / N:")
print(exp_df.round(3).to_string())
print(f"\nPer-cell (O − E)² / E:")
print(contrib_df.round(3).to_string())
print(f"\nRow sums of contributions: "
      f"{[round(s, 3) for s in contrib.sum(axis=1).tolist()]}")
print(f"Total χ²                    = {chi2_stat:.4f}")
print(f"df = (r−1)(c−1) = (4−1)(4−1) = {df_chi}")
print(f"p (χ²_{df_chi} > {chi2_stat:.2f})  = {p_chi:.3e}")
print(f"Cramer's V = √(χ² / (N · (min(r,c)−1)))")
print(f"          = √({chi2_stat:.2f} / ({N} · {min(ct.shape)-1}))"
      f" = {cramers_v:.4f}\n")


# ===========================================================================
# Test B — log(pot_t) ~ log(pot_{t-1}) + C(table_id), cluster-robust SE
# ===========================================================================

table_only = smf.ols("log_pot ~ C(table_id)", data=pairs).fit()
fit_b = smf.ols("log_pot ~ log_pot_lag + C(table_id)", data=pairs)\
           .fit(cov_type="cluster",
                cov_kwds={"groups": pairs.table_id})

# Within-table partialled regression (Frisch–Waugh): regress log_pot on
# table dummies, regress log_pot_lag on table dummies, then OLS the
# two residuals; β̂ is identical to the joint fit's slope.
res_y = pairs.log_pot.values - table_only.predict(pairs).values
res_x_fit = smf.ols("log_pot_lag ~ C(table_id)", data=pairs).fit()
res_x = pairs.log_pot_lag.values - res_x_fit.predict(pairs).values
Sxx = (res_x ** 2).sum()
Sxy = (res_x * res_y).sum()
beta_within = Sxy / Sxx
SSE_within = ((res_y - beta_within * res_x) ** 2).sum()

print("=== Test B: log-OLS arithmetic with table FE ===")
print(f"After table FE residualisation (Frisch–Waugh):")
print(f"  Σ(x̃²)            = {Sxx:.4f}     (centred lag log-pot)")
print(f"  Σ(x̃·ỹ)            = {Sxy:.4f}     (centred cross-product)")
print(f"  β̂_within         = Σ(x̃·ỹ)/Σ(x̃²) = {beta_within:.4f}")
print(f"  matches joint fit β̂ (log_pot_lag) = "
      f"{fit_b.params['log_pot_lag']:.4f}")
print(f"\nResidual sum of squares of joint fit (uses all parameters):")
print(f"  SSE_lin           = {fit_b.ssr:.4f}, df_resid = {int(fit_b.df_resid)}")
print(f"\nCluster-robust SE by table_id (6 clusters):")
print(f"  SE_cluster(β̂)    = {fit_b.bse['log_pot_lag']:.4f}")
print(f"  t                 = β̂ / SE = {fit_b.tvalues['log_pot_lag']:.3f}")
print(f"  p (two-sided)     = {fit_b.pvalues['log_pot_lag']:.3e}")
ci = fit_b.conf_int().loc["log_pot_lag"].to_list()
print(f"  95% CI on β       = [{ci[0]:.4f}, {ci[1]:.4f}]")
print(f"  R² (joint)        = {fit_b.rsquared:.4f}")
print(f"  R² (table FE only)= {table_only.rsquared:.4f}")
print(f"  ΔR² from lag      = {fit_b.rsquared - table_only.rsquared:.4f}")
print(f"  e^β̂ multiplier   = {np.exp(fit_b.params['log_pot_lag']):.4f}\n")


# ===========================================================================
# Test C — Lack-of-fit F-test on log scale
# ===========================================================================

pairs["lag_dec"] = pd.qcut(pairs.log_pot_lag, 10,
                            duplicates="drop").cat.codes
sat = smf.ols("log_pot ~ C(lag_dec) + C(table_id)", data=pairs).fit()
SSE_lin = fit_b.ssr
SSE_sat = sat.ssr
df_lin = fit_b.df_resid
df_sat = sat.df_resid
df_diff = df_lin - df_sat
SS_diff = SSE_lin - SSE_sat
MS_LoF = SS_diff / df_diff
MS_PE = SSE_sat / df_sat
F = MS_LoF / MS_PE
p_F = 1 - f_dist.cdf(F, df_diff, df_sat)

print("=== Test C: Lack-of-fit F arithmetic (log scale) ===")
print(f"Linear model:    log(pot_t) ~ log(pot_(t-1)) + C(table_id)")
print(f"Saturated model: log(pot_t) ~ C(lag_decile)  + C(table_id)")
print(f"  SSE_lin = {SSE_lin:.4f}, df_lin = {int(df_lin)}")
print(f"  SSE_sat = {SSE_sat:.4f}, df_sat = {int(df_sat)}")
print(f"  df_diff = df_lin − df_sat       = {int(df_diff)}")
print(f"  SS_diff = SSE_lin − SSE_sat     = {SS_diff:.4f}")
print(f"  MS_LoF  = SS_diff / df_diff     = {MS_LoF:.4f}")
print(f"  MS_PE   = SSE_sat / df_sat      = {MS_PE:.4f}")
print(f"  F       = MS_LoF / MS_PE        = {F:.4f}")
print(f"  p(F > {F:.2f}, df=({int(df_diff)}, {int(df_sat)})) = {p_F:.4f}\n")
print("Per lag-decile means (mean of log_pot_t given decile of log_pot_(t-1)):")
print(pairs.groupby("lag_dec", observed=True)
            .agg(n=("log_pot", "size"),
                 mean_lag_log=("log_pot_lag", "mean"),
                 mean_log=("log_pot", "mean"))
            .round(4).to_string())
print()


# ===========================================================================
# Companion effect-size measures (log scale): Pearson r, Spearman ρ
# ===========================================================================

r_log, p_log = pearsonr(x, y)
rho, p_rho = spearmanr(x, y)
print("=== Companion effect-size measures (log scale) ===")
print(f"  Pearson r          = {r_log:.4f}, p = {p_log:.3e}")
print(f"  Spearman ρ         = {rho:.4f}, p = {p_rho:.3e}")
print(f"  Pearson r²         = {r_log**2:.4f}")
print(f"  e^β̂ - 1            = "
      f"{np.exp(fit_b.params['log_pot_lag']) - 1:+.4f}  "
      f"(approx multiplicative effect per log unit of lag pot)\n")


# ===========================================================================
# Coda — Ljung-Box on within-table residuals (table FE only)
# ===========================================================================

table_codes = pairs.table_id.cat.codes.to_numpy()
resid = pairs.log_pot.values - table_only.predict(pairs).values
max_lag = 5
rk = np.zeros(max_lag)
for k in range(1, max_lag + 1):
    num = den = 0.0
    for t in np.unique(table_codes):
        mask = table_codes == t
        r = resid[mask] - resid[mask].mean()
        if len(r) <= k:
            continue
        num += (r[k:] * r[:-k]).sum()
        den += (r * r).sum() * (len(r) - k) / max(len(r), 1)
    rk[k-1] = num / den if den > 0 else 0
n_eff = len(resid)
q_terms = (rk ** 2) / (n_eff - np.arange(1, max_lag + 1))
Q = n_eff * (n_eff + 2) * q_terms.cumsum()
p_Q = [1 - chi2_dist.cdf(Q[k], k + 1) for k in range(max_lag)]

print("=== Coda: Ljung-Box arithmetic ===")
print(f"  n_eff = {n_eff}")
print(f"  Q_k = n(n+2) · Σ_{{j≤k}} r_j² / (n − j)\n")
print(f"  k | r_k       | r_k²       | r_k²/(n-k)   | Q_k         | p(χ²_k)")
cum = 0.0
for k in range(1, max_lag + 1):
    cum += rk[k-1] ** 2 / (n_eff - k)
    Qk = n_eff * (n_eff + 2) * cum
    print(f"  {k} | {rk[k-1]:+.4f}  | {rk[k-1]**2:.4f}    | "
          f"{rk[k-1]**2/(n_eff-k):.6f}    | {Qk:9.3f}   | {p_Q[k-1]:.4g}")
