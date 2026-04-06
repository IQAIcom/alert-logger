---
"@iqai/alert-logger": minor
---

Add configurable HealthPolicy for adapter health/retry behavior

- New `health` config option with `unhealthyThreshold`, `healthWindowMs`, `drainIntervalMs`, `maxRetries`, and `entryExpiryMs`
- Extract shared `formatDuration` utility to eliminate duplication between health-manager and discord formatter
- Fix drain-only recovery: `onRecovery` now fires when adapters become unhealthy purely through background drain retries
- Immediate re-drain after discarding expired queue entries for faster stale queue cleanup
