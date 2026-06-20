---
title: Window Tokenization (size W, stride S)
slug: window-tokenization
kind: feature_extraction
stage: feature
modality:
- time_series
task:
- forecasting
tags:
- module
source_papers:
- attnembed-2402-05370
input_contract:
  modality: univariate_time_series
output_contract:
  modality: windowed_time_series
date_added: '2026-06-18'
parameters:
- name: window_size
  value: W
- name: stride
  value: S
---
