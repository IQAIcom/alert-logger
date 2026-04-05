# Changelog

## 0.1.0

Initial release.

### Features

- **Core engine**: unified alert API with `info`, `warn`, `error`, `critical` methods
- **Error fingerprinting**: automatic deduplication via MD5 hash of normalized error message + stack frames
- **Smart aggregation**: exponential suppression (onset -> ramp -> sustained -> resolution)
- **Multi-channel routing**: route alerts by severity level or custom tags to different webhook URLs
- **Per-environment config**: different thresholds, levels, and ping rules for prod/staging/dev
- **Environment badges**: `[PROD]`, `[STG]`, `[DEV]` prefix on every alert

### Adapters

- **DiscordAdapter**: color-coded embeds, mention sanitization, 429 retry with Retry-After
- **ConsoleAdapter**: TTY-aware pretty/JSON output

### Reliability

- **RetryQueue**: ring buffer with configurable max size, FIFO drain
- **HealthManager**: per-adapter health tracking, graceful degradation, recovery detection
- **Disk persistence**: atomic JSON save/load for crash recovery

### Framework Integrations

- **NestJS** (`@iqai/alert-logger/nestjs`): global module, injectable service, exception filter, request context via AsyncLocalStorage
- **Next.js** (`@iqai/alert-logger/nextjs`): instrumentation.ts handler, onRequestError hook, getAlertLogger for manual use
