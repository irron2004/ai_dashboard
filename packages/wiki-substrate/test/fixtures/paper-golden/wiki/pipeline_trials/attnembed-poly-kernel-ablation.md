---
title: AttnEmbed with polynomial-kernel embedding (paper ablation)
slug: attnembed-poly-kernel-ablation
source_pipeline: attnembed-forecasting
task: long-term time series forecasting
status: succeeded
changed_modules:
- role: embed
  from_module: attention-embedding
  to_module: kernel-attention-polynomial
  reason: test kernel-as-attention hypothesis
success_reason: polynomial kernel reduced MSE 4.2% vs PatchTST on ETTh1
date_completed: '2026-06-18'
---
