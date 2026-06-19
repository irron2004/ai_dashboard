---
title: RBF-Kernel Attention Embedding
slug: kernel-attention-rbf
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
  result: matches softmax attention (SOTA-comparable)
  confidence: high
---
