---
'@iqai/alert-logger': minor
---

Make sustained alerting quieter and more informative by:

- adding rate-aware early handoff from ramp to sustained mode
- changing the default sustained update interval from 5 minutes to 15 minutes
- adding `aggregation.periodCount` for per-update deltas while keeping `suppressedSince` for compatibility
- exposing `aggregation.rampExitRatePerSecond` and `aggregation.rampExitRateWindowMs` configuration knobs
- updating sustained formatter output to show both per-period and total counts
