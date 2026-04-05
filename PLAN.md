# Implementation Plan

## Phase 1: Core Engine

### 1.1 Project scaffolding
- Initialize TypeScript project with tsup for building
- Configure package.json with subpath exports
- Set up ESLint, Prettier, Vitest
- Configure tsconfig for multiple entrypoints

### 1.2 Types and interfaces
- `AlertLevel`: `'info' | 'warning' | 'critical'`
- `Alert`: raw alert data (level, title, message, error, fields, tags, dedupKey)
- `FormattedAlert`: adapter-ready payload after aggregation metadata is attached
- `AlertAdapter`: interface (name, levels, send, rateLimits, formatAlert?, healthy?)
- `AlertLoggerConfig`: full configuration shape with defaults

### 1.3 Fingerprinter
- Normalize error messages: strip UUIDs, hex addresses, timestamps, numbers
- Extract top N stack frames (configurable, default 3), filter out node_modules
- Hash: `md5(errorName + normalizedMessage + stackKey)`
- Support custom `dedupKey` override
- Support user-defined normalizer patterns

### 1.4 Aggregator
- State per fingerprint: `{ count, firstSeen, lastSeen, phase, peakRate, lastAlertedAt, lastAlertedCount }`
- Phase transitions:
  - `onset`: count === 1 → send full alert
  - `ramp`: count is power of 2 (2, 4, 8... 64) → send compact alert with suppressed count
  - `sustained`: count > rampThreshold → send digest every digestIntervalMs
  - `resolution`: no hits for resolutionCooldownMs → send resolved, evict state
- Resolution timer: periodic check (every 30s) scans state for candidates
- State cleanup: evict entries after resolution + grace period

### 1.5 Router
- Level-based routing: map level → webhook URL (overrides adapter default)
- Tag-based routing: map tag → webhook URL (takes priority over level)
- Ping configuration: map level → mention strings
- Cascade: tag match → level match → default adapter

### 1.6 Environment configuration
- Per-environment overrides: merge environment-specific config over root config at init
- Support `production`, `staging`, `development` (and custom environment names)
- Override: levels, pings, aggregation thresholds per environment
- Environment badges: prefix embed titles with `[PROD]`, `[STG]`, `[DEV]`
- Badge mapping configurable for custom environment names

### 1.7 AlertLogger (orchestrator)
- `AlertLogger.init(config)` — returns singleton instance
- Methods: `.info()`, `.warn()`, `.error()`, `.critical()`
- Pipeline: validate → fingerprint → aggregate → route → adapter.send()
- Attach metadata: serviceName, environment, timestamp

## Phase 2: Adapters

### 2.1 ConsoleAdapter
- Structured JSON output (production) or pretty-printed (development)
- Respects all alert levels
- Color-coded output in TTY mode
- No external dependencies

### 2.2 DiscordAdapter
- Format alerts as Discord embeds with color-coded sidebars
- Severity colors: info (blue), warning (orange), critical (red), resolved (green)
- Embed fields for structured metadata
- Mention sanitization (prevent @everyone/@here injection)
- Handle Discord 429 with Retry-After header
- Rate limits: 30 per 60s (reported via rateLimits())
- Onset: full embed with stack trace in code block
- Ramp: compact embed with suppression count
- Sustained: digest embed with stats
- Resolution: green embed with totals

## Phase 3: Reliability

### 3.1 Retry queue
- In-memory ring buffer (configurable max size, default 500)
- Failed sends enqueue with timestamp and retry count
- Periodic drain attempt (every 10s) when adapter reports healthy
- Optional disk persistence: write queue to JSON file at configurable path
- Load from disk on startup

### 3.2 Graceful degradation
- Track adapter health: last successful send, consecutive failures
- After 30s unhealthy: log one console warning, suppress further warnings
- Alerts continue through aggregation (counts accurate) but queue instead of send
- On recovery: drain queue, send "recovered" summary

## Phase 4: Framework Integrations

### 4.1 NestJS integration (`@iqai/alert-logger/nestjs`)
- `AlertLoggerModule.forRoot(config)` — `@Global()` module
- `AlertLoggerModule.forRootAsync({ useFactory, inject })` — async config
- `AlertLoggerService` — injectable wrapper around AlertLogger instance
- Global exception filter: auto-catch unhandled HTTP exceptions, send 5xx through pipeline
- Filter attaches: method, path, status code, IP as fields
- Request context middleware: `AsyncLocalStorage` captures requestId, method, path
- Auto-attaches request context to all alerts fired during the request lifecycle
- requestId from `x-request-id` header or auto-generated UUID

### 4.2 NextJS integration (`@iqai/alert-logger/nextjs`)
- `createAlertLoggerHandler(config)` — initialize in `instrumentation.ts` `register()`
- `captureRequestError` — `onRequestError` handler for Next.js 15+
- Server-only: `"node"` condition in exports, never bundles to client
- Attach: request path, method, component type as fields

## Phase 5: Testing and Docs

### 5.1 Tests
- Fingerprinter: normalization patterns, hash stability, custom normalizers
- Aggregator: phase transitions (onset → ramp → sustained → resolution), timing, edge cases
- Router: level cascade, tag priority, ping attachment
- DiscordAdapter: embed formatting, rate limit handling, retry logic
- Integration: end-to-end pipeline with mock adapter
- NestJS: module initialization, exception filter behavior

### 5.2 Documentation
- README with quick start for all three modes (standalone, NestJS, NextJS)
- Custom adapter guide
- Configuration reference
- Migration guide from raw Discord webhook code

## Phase 6: Publish

### 6.1 Package publishing
- npm publish as `@iqai/alert-logger`
- CI/CD with GitHub Actions (lint, test, build, publish on tag)
- Semantic versioning
- Changelog generation
