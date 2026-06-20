---
title: Polynomial-Kernel Attention Embedding
slug: kernel-attention-polynomial
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
evidence:
- source: attnembed-2402-05370
  metric: MSE
  result: -4.2% MSE / -2.0% MASE vs PatchTST on ETTh1
  confidence: high
---
