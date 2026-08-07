#!/usr/bin/env python3
"""
Lack-of-fit F-test introduction — arithmetic walkthrough.

Companion to lack-of-fit.py. Where the main script just runs the
high-level statsmodels routines and prints the results, this script
prints every intermediate quantity that the blog post plugs into a
formula by hand:

    Linear OLS:     Sigma_x, Sigma_y, Sigma_x^2, Sigma_y^2, Sigma_xy,
                    Sxx, Syy, Sxy, beta_0, beta_1, SSE, R^2, s,
                    SE(beta_1), t, p, t*, 95% CI.

    Per-mass-bin:   n_k, y-bar_k, within-bin SS.

    Pure error:     SS_PE as the sum of the within-bin SS
                    (also written SSE_sat in some textbooks; it is the
                    residual SSE of the saturated bin-mean model).

    Lack-of-fit F:  SSE_lin, SS_PE, SS_LoF,
                    df_LoF = (k - 2), df_PE = (n - k),
                    MS_LoF, MS_PE, F, F*(0.05), p.

Run:      python3 lack-of-fit-arith.py
Depends:  numpy, pandas, scipy.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import f as f_dist
from scipy.stats import t as student_t

# ---------------------------------------------------------------------------
# Re-generate the same dataset as lack-of-fit.py
# ---------------------------------------------------------------------------

RNG = np.random.default_rng(20260528)
MASS_LEVELS_G = np.array([100, 200, 300, 400, 500, 600, 700, 800])
REPLICATES = 10
TRUE_BETA_LIN = 0.45
TRUE_BETA_QUAD = 0.06
NOISE_SD = 0.18

masses = np.repeat(MASS_LEVELS_G, REPLICATES).astype(float)
m100 = masses / 100.0
truth = TRUE_BETA_LIN * m100 + TRUE_BETA_QUAD * m100 ** 2
noise = RNG.normal(0.0, NOISE_SD, size=len(masses))
extensions = truth + noise

x = masses
y = extensions
n = len(x)
k = len(np.unique(x))

# ---------------------------------------------------------------------------
# X-related and Y-related sums
# ---------------------------------------------------------------------------

xbar = x.mean()
ybar = y.mean()
Sxx = ((x - xbar) ** 2).sum()
Syy = ((y - ybar) ** 2).sum()
Sxy = ((x - xbar) * (y - ybar)).sum()

# ---------------------------------------------------------------------------
# Linear OLS arithmetic
# ---------------------------------------------------------------------------

beta1 = Sxy / Sxx
beta0 = ybar - beta1 * xbar
yhat = beta0 + beta1 * x
SSE_lin = ((y - yhat) ** 2).sum()
SST = Syy
R2 = 1 - SSE_lin / SST
df_lin_resid = n - 2
s2 = SSE_lin / df_lin_resid
s = np.sqrt(s2)
SE_b1 = s / np.sqrt(Sxx)
t_stat = beta1 / SE_b1
p_t = 2 * student_t.sf(abs(t_stat), df_lin_resid)
tstar = student_t.ppf(0.975, df_lin_resid)
ci = (beta1 - tstar * SE_b1, beta1 + tstar * SE_b1)

print("=== Linear OLS arithmetic ===")
print(f"n                = {n}")
print(f"k (mass levels)  = {k}")
print(f"xbar             = {xbar:.6f}")
print(f"ybar             = {ybar:.6f}")
print(f"Sigma x          = {x.sum():.4f}")
print(f"Sigma y          = {y.sum():.4f}")
print(f"Sigma x^2        = {(x**2).sum():.4f}")
print(f"Sigma y^2        = {(y**2).sum():.6f}")
print(f"Sigma xy         = {(x*y).sum():.4f}")
print(f"Sxx              = Sigma (x - xbar)^2     = {Sxx:.4f}")
print(f"Syy = SST        = Sigma (y - ybar)^2     = {Syy:.6f}")
print(f"Sxy              = Sigma (x-xbar)(y-ybar) = {Sxy:.4f}")
print(f"beta_1_hat       = Sxy / Sxx              = {beta1:.8f}")
print(f"beta_0_hat       = ybar - beta_1 . xbar   = {beta0:.6f}")
print(f"SSE_lin          = Sigma (y - yhat)^2     = {SSE_lin:.6f}")
print(f"SSR              = SST - SSE              = {SST - SSE_lin:.6f}")
print(f"R^2              = SSR / SST              = {R2:.6f}")
print(f"df_resid         = n - 2                  = {df_lin_resid}")
print(f"s^2              = SSE / (n - 2)          = {s2:.6f}")
print(f"s                = sqrt(s^2)              = {s:.6f}")
print(f"SE(beta_1)       = s / sqrt(Sxx)          = {SE_b1:.8f}")
print(f"t                = beta_1 / SE            = {t_stat:.4f}")
print(f"two-sided p      = {p_t:.4g}")
print(f"t*(0.975, {df_lin_resid})   = {tstar:.4f}")
print(f"95% CI on beta_1 = [{ci[0]:.6f}, {ci[1]:.6f}] cm/g")
print()

# ---------------------------------------------------------------------------
# Per-bin sums (saturated model)
# ---------------------------------------------------------------------------

df = pd.DataFrame({"mass_g": x, "extension_cm": y})
bin_stats = (df.groupby("mass_g")
               .agg(n_k=("extension_cm", "size"),
                    sum_y=("extension_cm", "sum"),
                    mean_y=("extension_cm", "mean"),
                    sumsq_dev=("extension_cm",
                               lambda v: ((v - v.mean()) ** 2).sum()))
               .reset_index())

print("=== Per-mass-level (saturated model) arithmetic ===")
print(f"{'mass_g':>8} {'n_k':>4} {'mean_y':>10} {'sumsq_dev':>14}")
for _, row in bin_stats.iterrows():
    print(f"{int(row.mass_g):>8} {int(row.n_k):>4} "
          f"{row.mean_y:>10.4f} {row.sumsq_dev:>14.6f}")

SS_PE = bin_stats.sumsq_dev.sum()
df_PE = n - k
print(f"\nSS_PE (sum of within-bin SS) = {SS_PE:.6f}")
print(f"df_PE = n - k                 = {df_PE}")
print()

# ---------------------------------------------------------------------------
# Lack-of-fit F-test arithmetic
# ---------------------------------------------------------------------------

SS_LoF = SSE_lin - SS_PE
df_LoF = df_lin_resid - df_PE                 # = k - 2
MS_LoF = SS_LoF / df_LoF
MS_PE = SS_PE / df_PE
F = MS_LoF / MS_PE
p_F = f_dist.sf(F, df_LoF, df_PE)
Fcrit = f_dist.ppf(0.95, df_LoF, df_PE)

print("=== Lack-of-fit F-test arithmetic ===")
print(f"SSE_lin                    = {SSE_lin:.6f}")
print(f"SS_PE                      = {SS_PE:.6f}")
print(f"SS_LoF = SSE_lin - SS_PE   = {SS_LoF:.6f}")
print(f"df_LoF = k - 2             = {df_LoF}")
print(f"df_PE  = n - k             = {df_PE}")
print(f"MS_LoF = SS_LoF / df_LoF   = {MS_LoF:.6f}")
print(f"MS_PE  = SS_PE  / df_PE    = {MS_PE:.6f}")
print(f"F      = MS_LoF / MS_PE    = {F:.6f}")
print(f"F*(0.05, {df_LoF}, {df_PE})      = {Fcrit:.4f}")
print(f"p(F_{df_LoF},{df_PE} > {F:.4f}) = {p_F:.3g}")

# ---------------------------------------------------------------------------
# Sanity: per-bin residual from the linear fit
# (the average distance from each bin mean to the line)
# ---------------------------------------------------------------------------

bin_stats["lin_pred"] = beta0 + beta1 * bin_stats.mass_g
bin_stats["bin_resid"] = bin_stats.mean_y - bin_stats.lin_pred

print("\n=== Per-bin residual (mean_y minus linear prediction) ===")
print(f"{'mass_g':>8} {'mean_y':>10} {'lin_pred':>10} {'resid':>10}")
for _, row in bin_stats.iterrows():
    print(f"{int(row.mass_g):>8} {row.mean_y:>10.4f} "
          f"{row.lin_pred:>10.4f} {row.bin_resid:>+10.4f}")
