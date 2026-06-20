---
title: AttnEmbed Time-Series Forecasting
slug: attnembed-forecasting
origin: paper
source_paper: attnembed-2402-05370
task: long-term time series forecasting
modality:
- time_series
tags:
- recipe
- forecasting
stages:
- role: normalize
  module: instance-normalization
  required: true
- role: channelize
  module: channel-independence
  required: true
- role: tokenize
  module: window-tokenization
  required: true
- role: embed
  module: attention-embedding
  required: true
- role: encode
  module: transformer-encoder
  required: true
- role: forecast
  module: linear-projection-head
  required: true
metrics:
- name: MSE
  value: SOTA on 6/7 (ETT/Electricity/Weather/Traffic)
reproducibility: partial
code_available: false
date_added: '2026-06-18'
---
