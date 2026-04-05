# @iqai/alert-logger — Design Spec

**Date:** 2026-04-05
**Status:** Approved

## Problem

Teams using Discord (or Slack, etc.) for error alerting face three problems:

1. **Alert storms** — one bug triggers thousands of identical messages, burying the channel and desensitizing the team.
2. **Code duplication** — every error path requires separate calls to the console logger, Discord webhook, and Sentry. In practice this means 3 calls per error, repeated across every service.
3. **No incident lifecycle** — you know when an error starts, but never when it stops. There's no "resolved" signal.

## Solution

A TypeScript alert logging library with:

- **Unified API** — one call routes to console, Discord, Sentry, or any adapter.
- **Smart aggregation** — exponential suppression, periodic digests, and automatic resolution detection.
- **Adapter architecture** — ship Discord + Console built-in; Sentry, Slack, Telegram as separate packages. Community can implement the interface for any destination.
- **Framework integrations** — drop-in NestJS module and NextJS instrumentation hook.

## Package Structure

Single npm package with subpath exports:

```
@iqai/alert-logger
├── src/
│   ├── core/                        # Framework-agnostic engine
│   │   ├── alert-logger.ts          # Main orchestrator — singleton + instance API
│   │   ├── aggregator.ts            # Exponential suppression + digest engine
│   │   ├── fingerprinter.ts         # Error similarity hashing
│   │   ├── router.ts                # Level/tag → adapter+channel routing
│   │   └── types.ts                 # Shared interfaces
│   ├── adapters/
│   │   ├── adapter.interface.ts     # Base adapter contract
│   │   ├── discord/                 # Discord webhook adapter
│   │   │   ├── discord-adapter.ts
│   │   │   └── formatter.ts         # Embed formatting
│   │   └── console/                 # Structured console fallback
│   │       └── console-adapter.ts
│   ├── integrations/
│   │   ├── nestjs/                  # NestJS module + exception filter
│   │   │   ├── alert-logger.module.ts
│   │   │   ├── alert-logger.service.ts
│   │   │   └── exception.filter.ts
│   │   └── nextjs/                  # NextJS instrumentation hook
│   │       ├── handler.ts
│   │       └── index.ts
│   └── index.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts                   # Build config
```

### Subpath Exports

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./nestjs": "./dist/integrations/nestjs/index.js",
    "./nextjs": {
      "node": "./dist/integrations/nextjs/index.js",
      "default": null
    }
  },
  "peerDependencies": {
    "@nestjs/common": ">=10",
    "@nestjs/config": ">=3",
    "next": ">=14"
  },
  "peerDependenciesMeta": {
    "@nestjs/common": { "optional": true },
    "@nestjs/config": { "optional": true },
    "next": { "optional": true }
  }
}
```

- NestJS/NextJS deps are optional peers — users only install what they use.
- Core has zero framework deps — just `node:crypto` and `fetch`.
- NextJS export uses the `"node"` condition so it never leaks into client bundles.

## Adapter Interface

```ts
interface AlertAdapter {
  readonly name: string;

  // Which levels this adapter handles
  levels: AlertLevel[];

  // Send an alert — the core engine calls this after aggregation
  send(alert: FormattedAlert): Promise<void>;

  // Adapter declares its own rate limits so the engine can respect them
  rateLimits(): { maxPerWindow: number; windowMs: number };

  // Optional: adapter-specific formatting (embeds, blocks, etc.)
  formatAlert?(alert: Alert): FormattedAlert;

  // Optional: health check
  healthy?(): Promise<boolean>;
}
```

### Built-in Adapters

**DiscordAdapter** — posts color-coded embeds to webhooks. Handles Discord 429 retry. Supports thread-per-incident (optional).

**ConsoleAdapter** — structured JSON or pretty-printed output to stdout. Always available as fallback.

### Separate Packages (future)

- `@iqai/alert-logger-sentry` — Sentry adapter (`captureException` / `captureMessage`)
- `@iqai/alert-logger-slack` — Slack Block Kit adapter
- `@iqai/alert-logger-telegram` — Telegram Bot API adapter

### Community Adapters

Anyone implements `AlertAdapter`:

```ts
class PagerDutyAdapter implements AlertAdapter { ... }
class DatadogAdapter implements AlertAdapter { ... }
class TeamsAdapter implements AlertAdapter { ... }
```

## Aggregation Engine

Every alert flows through this pipeline:

```
alert comes in
    → fingerprint(alert) → hash
    → lookup hash in state
    → apply phase logic
    → route to adapters (or suppress)
```

### Fingerprinting

Determines "what counts as the same error":

```
hash(
  error.name +                          // "TypeError"
  normalize(error.message) +            // strip IDs, timestamps, UUIDs, hex
  top3StackFrames(error.stack)          // file:line:col of first 3 app frames
)
```

The `normalize` step strips variable parts:
- `"User 0x3f8a not found"` → `"User <id> not found"`
- `"Timeout after 3241ms"` → `"Timeout after <num>ms"`
- `"Failed at 2026-04-05T12:00:00Z"` → `"Failed at <timestamp>"`

Users can override with `dedupKey` when they know better:
```ts
alertLogger.error('Trade failed', error, { dedupKey: `trade:${tradeId}` })
```

Users can add custom normalizers for domain-specific patterns:
```ts
fingerprint: {
  normalizers: [
    { pattern: /0x[a-fA-F0-9]{40}/g, replacement: '<address>' },
  ],
}
```

### Phases

| Phase | Trigger | Behavior |
|-------|---------|----------|
| **Onset** | 1st occurrence | Send immediately with full context (stack trace, fields, tags) |
| **Ramp** | Count is power of 2 (2, 4, 8, 16, 32, 64) | Send compact alert: title + `"(×8 — 4 suppressed since last)"` |
| **Sustained** | Count > 64 in window | Digest every 5min: `"×4,812 in last 5m · peak rate: 200/s"` |
| **Resolution** | 0 hits for cooldown period | Send resolved message: `"Resolved after 12,847 total over 23m"` |

### Configuration

```ts
aggregation: {
  rampThreshold: 64,               // switch to digest after this many
  digestIntervalMs: 5 * 60_000,    // digest frequency (default 5min)
  resolutionCooldownMs: 2 * 60_000, // "resolved" after 2min silence
}
```

### State Management

Each fingerprint's state (count, firstSeen, lastSeen, phase, peakRate) lives in memory. Entries are evicted after resolution + grace period. A periodic timer checks for resolution candidates.

## Routing

```ts
routing: {
  // Level-based: different webhook per severity
  channels: {
    info: process.env.DISCORD_INFO_WEBHOOK,
    warning: process.env.DISCORD_WARNINGS_WEBHOOK,
    critical: process.env.DISCORD_ONCALL_WEBHOOK,
  },
  // Tag-based: route by service/domain
  tags: {
    indexer: process.env.DISCORD_INDEXER_WEBHOOK,
    relayer: process.env.DISCORD_RELAYER_WEBHOOK,
  },
  // Who gets pinged at what level
  pings: {
    warning: [],
    critical: ['@here'],
  },
}
```

Routing cascade: tag match → level match → default adapter webhook.

## Environment Configuration

Per-environment overrides so the same codebase behaves differently without changing application code. Dev errors suppress aggressively, staging never pings, prod pings on critical.

```ts
environments: {
  production: {
    levels: ['warning', 'critical'],
    pings: { critical: ['@here'] },
    aggregation: { digestIntervalMs: 5 * 60_000 },
  },
  staging: {
    levels: ['critical'],
    pings: {},
    aggregation: { digestIntervalMs: 15 * 60_000 },
  },
  development: {
    levels: ['critical'],
    pings: {},
    aggregation: { rampThreshold: 8, digestIntervalMs: 30 * 60_000 },
  },
}
```

The active environment is set via `environment` in root config (typically from `process.env.NODE_ENV`). Environment-specific values are shallow-merged over root config at init time — no runtime branching.

### Environment Badges

Every embed is prefixed with a visual environment badge so alerts are immediately scannable:

- Production: `[PROD]` (no prefix color change — default severity colors)
- Staging: `[STG]`
- Development: `[DEV]`

The badge appears in the embed title: `[PROD] [CRITICAL] Trade Settlement Failed`. This prevents the "is this real or staging?" confusion that hits small teams sharing channels.

## Request Context (NestJS)

In NestJS, the module registers an `AsyncLocalStorage`-backed middleware. For every incoming HTTP request, it captures:

- `requestId` (from `x-request-id` header or auto-generated UUID)
- `method` (GET, POST, etc.)
- `path` (`/api/markets/123`)

Any `alert.error()` call during that request lifecycle automatically gets these fields attached — no manual passing required.

```ts
// Developer writes:
this.alert.error('Payment failed', error, { fields: { orderId: '123' } })

// Alert automatically includes:
// fields: { orderId: '123', requestId: 'abc-def', method: 'POST', path: '/api/checkout' }
```

This uses `AsyncLocalStorage` from `node:async_hooks` which has negligible performance overhead in modern Node.js. The context is opt-in: if the middleware isn't registered (e.g. standalone usage, cron jobs), alerts work normally without request fields.

## Reliability

**Retry queue:** Failed sends go into an in-memory ring buffer (default 500). Drains when adapter reports healthy. Optional disk persistence via configurable path.

**Graceful degradation:** If adapter unhealthy >30s, log one console warning, then suppress. Alerts continue flowing through aggregation (counts stay accurate) — they queue instead of send. On recovery, drain queue + send "recovered" summary.

**ConsoleAdapter as fallback:** Ships built-in, always runs. Same structured format, always available.

## Framework Integrations

### NestJS

```ts
// app.module.ts
@Module({
  imports: [
    AlertLoggerModule.forRoot({
      adapters: [new DiscordAdapter({ webhookUrl: '...' })],
      serviceName: 'indexer',
      routing: { ... },
    }),
  ],
})
```

- `@Global()` module — `AlertLoggerService` injectable everywhere.
- Auto-registers global exception filter — 5xx errors go through the pipeline without touching service code.
- `AlertLoggerService` replaces both `Logger` and `DiscordAlertService` — one injection, one call.

### NextJS

```ts
// instrumentation.ts
import { createAlertLoggerHandler, captureRequestError } from '@iqai/alert-logger/nextjs'

export function register() {
  createAlertLoggerHandler({
    adapters: [new DiscordAdapter({ webhookUrl: '...' })],
    serviceName: 'frontend',
  })
}

export { captureRequestError as onRequestError }
```

- Uses Next.js 15 `instrumentation.ts` + `onRequestError` hook.
- Server-only — `"node"` condition in exports prevents client bundling.
- No middleware (Edge runtime is too constrained).

## API Surface

### Standalone

```ts
import { AlertLogger, DiscordAdapter } from '@iqai/alert-logger'

const logger = AlertLogger.init({ adapters: [...] })

logger.info('Deployment complete', { fields: { version: '1.2.3' } })
logger.warn('Queue depth high', { fields: { depth: 150 }, dedupKey: 'queue:main' })
logger.error('Payment failed', error, { fields: { orderId: 'abc' } })
logger.critical('Database unreachable', error, { tags: ['infra'] })
```

### NestJS (injected)

```ts
@Injectable()
export class MyService {
  constructor(private readonly alert: AlertLoggerService) {}

  async doWork() {
    this.alert.error('Something failed', error, {
      fields: { tradeId: '123' },
      dedupKey: `trade:123`,
    })
  }
}
```

## Full Configuration

```ts
AlertLogger.init({
  // Required
  adapters: [new DiscordAdapter({ webhookUrl: '...' })],

  // Identity
  serviceName: 'backend',
  environment: 'production',

  // Aggregation
  aggregation: {
    rampThreshold: 64,
    digestIntervalMs: 5 * 60_000,
    resolutionCooldownMs: 2 * 60_000,
  },

  // Routing
  routing: {
    channels: { critical: '...' },
    tags: { indexer: '...' },
    pings: { critical: ['@here'] },
  },

  // Per-environment overrides
  environments: {
    production: {
      levels: ['warning', 'critical'],
      pings: { critical: ['@here'] },
      aggregation: { digestIntervalMs: 5 * 60_000 },
    },
    staging: {
      levels: ['critical'],
      pings: {},
      aggregation: { digestIntervalMs: 15 * 60_000 },
    },
    development: {
      levels: ['critical'],
      pings: {},
      aggregation: { rampThreshold: 8, digestIntervalMs: 30 * 60_000 },
    },
  },

  // Reliability
  queue: {
    maxSize: 500,
    persistPath: null,
  },

  // Fingerprinting
  fingerprint: {
    stackDepth: 3,
    normalizers: [
      { pattern: /0x[a-fA-F0-9]{40}/g, replacement: '<address>' },
    ],
  },
})
```

Everything except `adapters` has sensible defaults. Minimal setup:

```ts
AlertLogger.init({
  adapters: [new DiscordAdapter({ webhookUrl: '...' })],
})
```

## Migration Path (from prediction codebase)

```diff
// app.module.ts
- DiscordAlertModule,
+ AlertLoggerModule.forRoot({ adapters: [new DiscordAdapter({ webhookUrl: ... })] }),

// any service — 3 injections become 1
- private readonly logger = new Logger(MyService.name);
- constructor(
-   private readonly discordAlert: DiscordAlertService,
-   private readonly sentry: SentryService,
- ) {}
+ constructor(private readonly alert: AlertLoggerService) {}

// every error path — 3 calls become 1
- this.logger.error(msg);
- this.sentry.captureException(error, context);
- void this.discordAlert.sendAlert('critical', title, msg, fields, { dedupKey });
+ this.alert.error(title, error, { fields, dedupKey });
```

## Testing Strategy

- Unit tests for fingerprinter (normalization, hashing).
- Unit tests for aggregator (phase transitions, suppression counts, resolution detection).
- Unit tests for router (level/tag cascade).
- Integration tests with mock adapter to verify end-to-end pipeline.
- Manual testing with real Discord webhook in development.

## Non-Goals

- Not a replacement for structured application logging (Pino, Winston). This is for alerts.
- Not a monitoring/metrics system. No dashboards, no time-series data.
- Not a real-time incident management tool (PagerDuty, OpsGenie). Adapters can bridge to those.
