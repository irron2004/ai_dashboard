---
title: Shared Self-Attention Embedding (last-row concat)
slug: attention-embedding
kind: encoder
stage: encode
modality:
- time_series
task:
- forecasting
tags:
- module
source_papers:
- attnembed-2402-05370
input_contract:
  modality: windowed_time_series
output_contract:
  modality: embedding
date_added: '2026-06-18'
alternatives:
- kernel-attention-rbf
- kernel-attention-polynomial
evidence:
- source: attnembed-2402-05370
  metric: MSE
  result: -3.6% rel vs PatchTST (best on 6/7 datasets)
  confidence: high
---
