#!/usr/bin/env python3
"""
Pot size vs number of seated players — arithmetic walkthrough.

Companion to pot-vs-seats.py. Where the main script just calls the
high-level statsmodels routines and prints the results, this script
prints every intermediate quantity that the blog post plugs into a
formula by hand:

    Test 1 (raw OLS, dropped):  Σx, Σy, Σx², Σy², Σxy, Sxx, Syy, Sxy,
                                β̂₀, β̂₁, SSE, R², s, SE, t, p, CI.
    Test B (log OLS):            same set, on the log scale.
    Test C (lack-of-fit F):      SSE_lin, SSE_sat, df, MS_LoF, MS_PE, F, p.
    Test A (chi-square):         observed table, row/col totals, expected
                                 table, per-cell (O−E)²/E, χ², df, p,
                                 Cramer's V.

Run:      python3 pot-vs-seats-arith.py
Inputs:   pot-vs-seats-data.zip (next to this script)
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
from scipy.stats import t as student_t

HERE = Path(__file__).parent
DATA_ZIP = HERE / "pot-vs-seats-data.zip"
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
            .reset_index())

n = len(df)
x = df.num_seats.to_numpy().astype(float)
y = df.pot_bb.to_numpy().astype(float)


# ---------------------------------------------------------------------------
# Shared X-related sums
# ---------------------------------------------------------------------------

xbar = x.mean()
ybar = y.mean()
Sxx = ((x - xbar) ** 2).sum()
Syy = ((y - ybar) ** 2).sum()
Sxy = ((x - xbar) * (y - ybar)).sum()


# ===========================================================================
# Test 1 (raw OLS, dropped: LINER fails)
# ---------------------------------------------------------------------------
# We compute these only to display the would-be OLS line on the linear
# scatterplot. They are NOT reported as inference.
# ===========================================================================

beta1 = Sxy / Sxx
beta0 = ybar - beta1 * xbar
yhat = beta0 + beta1 * x
SSE = ((y - yhat) ** 2).sum()
SST = Syy
SSR_model = SST - SSE
R2 = 1 - SSE / SST
s2 = SSE / (n - 2)
s = np.sqrt(s2)
SE_b1 = s / np.sqrt(Sxx)
t_stat = beta1 / SE_b1
df_resid = n - 2
p_two = 2 * (1 - student_t.cdf(abs(t_stat), df_resid))
tstar = student_t.ppf(0.975, df_resid)
ci = (beta1 - tstar * SE_b1, beta1 + tstar * SE_b1)

print("=== Raw OLS arithmetic (DROPPED: LINER fails on raw scale) ===")
print(f"n        = {n}")
print(f"x̄       = {xbar:.6f}")
print(f"ȳ       = {ybar:.6f}")
print(f"Σx       = {x.sum():.4f}")
print(f"Σy       = {y.sum():.4f}")
print(f"Σx²      = {(x**2).sum():.4f}")
print(f"Σy²      = {(y**2).sum():.4f}")
print(f"Σxy      = {(x*y).sum():.4f}")
print(f"Sxx      = Σ(x−x̄)²     = {Sxx:.4f}")
print(f"Syy=SST  = Σ(y−ȳ)²     = {Syy:.4f}")
print(f"Sxy      = Σ(x−x̄)(y−ȳ) = {Sxy:.4f}")
print(f"β̂₁      = Sxy / Sxx    = {beta1:.6f}")
print(f"β̂₀      = ȳ − β̂₁·x̄   = {beta0:.6f}")
print(f"SSE      = Σ(y−ŷ)²    = {SSE:.4f}")
print(f"SSR      = SST − SSE   = {SSR_model:.4f}")
print(f"R²       = SSR / SST   = {R2:.6f}")
print(f"s²       = SSE / (n−2) = {s2:.4f}")
print(f"s        = √s²         = {s:.4f}")
print(f"SE(β̂₁)  = s / √Sxx    = {SE_b1:.6f}")
print(f"t        = β̂₁ / SE    = {t_stat:.4f}")
print(f"df_resid = n − 2       = {df_resid}")
print(f"two-sided p (descriptive only) = {p_two:.4g}")
print(f"t*(0.975, {df_resid}) = {tstar:.4f}")
print(f"95% CI on β₁ (descriptive) = "
      f"[{ci[0]:.4f}, {ci[1]:.4f}]\n")


# ===========================================================================
# Test B — Log-linear OLS slope t-test
# ===========================================================================

ly = np.log(y)
ly_bar = ly.mean()
Sllog = ((ly - ly_bar) ** 2).sum()
Sxlog = ((x - xbar) * (ly - ly_bar)).sum()
b1_log = Sxlog / Sxx
b0_log = ly_bar - b1_log * xbar
yhat_log = b0_log + b1_log * x
SSE_log = ((ly - yhat_log) ** 2).sum()
s2_log = SSE_log / (n - 2)
s_log = np.sqrt(s2_log)
SE_b1_log = s_log / np.sqrt(Sxx)
t_log = b1_log / SE_b1_log
p_log = 2 * (1 - student_t.cdf(abs(t_log), df_resid))
ci_log = (b1_log - tstar * SE_b1_log, b1_log + tstar * SE_b1_log)
R2_log = 1 - SSE_log / Sllog

print("=== Test B: Log-linear OLS arithmetic ===")
print(f"ℓ̄         = mean log(y)         = {ly_bar:.6f}")
print(f"Sℓℓ        = Σ(ℓ−ℓ̄)²            = {Sllog:.4f}")
print(f"Sxℓ        = Σ(x−x̄)(ℓ−ℓ̄)       = {Sxlog:.4f}")
print(f"β̂₁_log    = Sxℓ / Sxx           = {b1_log:.6f}")
print(f"β̂₀_log    = ℓ̄ − β̂₁_log · x̄    = {b0_log:.6f}")
print(f"SSE_log    = Σ(ℓ−ℓ̂)²            = {SSE_log:.4f}")
print(f"s²_log     = SSE/(n−2)            = {s2_log:.6f}")
print(f"s_log      = √s²                  = {s_log:.6f}")
print(f"SE(β̂₁_log)= s_log / √Sxx         = {SE_b1_log:.6f}")
print(f"t_log      = β̂₁_log / SE         = {t_log:.4f}")
print(f"two-sided p_log                    = {p_log:.4g}")
print(f"95% CI on β₁_log                   = "
      f"[{ci_log[0]:.4f}, {ci_log[1]:.4f}]")
print(f"e^β̂₁_log   = ×{np.exp(b1_log):.4f} per seat")
print(f"e^(4·β̂₁)   = ×{np.exp(4*b1_log):.4f}  (HU→6-max)")
print(f"R²_log     = {R2_log:.4f}\n")


# ===========================================================================
# Test C — Lack-of-fit F-test (log scale)
# ===========================================================================

lin_log_fit = smf.ols("np.log(pot_bb) ~ num_seats", data=df).fit()
sat_log_fit = smf.ols("np.log(pot_bb) ~ C(num_seats)", data=df).fit()
SSE_lin_log = lin_log_fit.ssr
SSE_sat_log = sat_log_fit.ssr
df_lin = lin_log_fit.df_resid
df_sat = sat_log_fit.df_resid
df_diff = df_lin - df_sat
SS_diff = SSE_lin_log - SSE_sat_log
MS_LoF = SS_diff / df_diff
MS_PE = SSE_sat_log / df_sat
F = MS_LoF / MS_PE
p_F = 1 - f_dist.cdf(F, df_diff, df_sat)

print("=== Test C: Lack-of-fit F arithmetic (log scale) ===")
print(f"SSE_lin_log = {SSE_lin_log:.4f},  df_lin = {df_lin}")
print(f"SSE_sat_log = {SSE_sat_log:.4f},  df_sat = {df_sat}")
print(f"df_diff     = df_lin − df_sat       = {df_diff}")
print(f"SS_diff     = SSE_lin − SSE_sat     = {SS_diff:.4f}")
print(f"MS_LoF      = SS_diff / df_diff     = {MS_LoF:.4f}")
print(f"MS_PE       = SSE_sat / df_sat      = {MS_PE:.4f}")
print(f"F           = MS_LoF / MS_PE        = {F:.4f}")
print(f"p(F > {F:.2f}, df=({df_diff}, {df_sat})) = {p_F:.4g}\n")

print("Per num_seats bin (log scale):")
print(df.groupby("num_seats")
        .agg(n=("pot_bb", "size"),
             mean_log_pot=("pot_bb", lambda v: np.log(v).mean()),
             sd_log_pot=("pot_bb", lambda v: np.log(v).std()))
        .round(4).to_string())
print()


# ===========================================================================
# Test A — Chi-square test of independence
# ===========================================================================

df["pot_cat"] = pd.qcut(df.pot_bb, 4, labels=["tiny", "small", "medium", "big"])
df["seat_cat"] = pd.cut(df.num_seats, bins=[1, 3, 5, 6, 9],
                        labels=["HU/3", "4-5", "6-max", "full ring"])
ct = pd.crosstab(df.seat_cat, df.pot_cat)

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
print("Observed counts:")
print(ct.to_string())
print("\nExpected counts (Rᵢ · Cⱼ / N):")
print(exp_df.round(3).to_string())
print("\nPer-cell (O − E)² / E:")
print(contrib_df.round(3).to_string())
print(f"\nRow sums of contributions: "
      f"{[round(s, 3) for s in contrib.sum(axis=1).tolist()]}")
print(f"Total χ²                  = {chi2_stat:.4f}")
print(f"df = (r−1)(c−1)           = {df_chi}")
print(f"p (χ²_{df_chi} > {chi2_stat:.2f})  = {p_chi:.4e}")
print(f"Cramer's V                 = {cramers_v:.4f}")
