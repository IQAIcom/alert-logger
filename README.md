# @iqai/alert-logger

Smart alert aggregation for any destination. One call to log everywhere — Discord, Sentry, Slack, console, or your own adapter.

Stop drowning in alert storms. `@iqai/alert-logger` groups repeated errors using exponential suppression, sends periodic digests during sustained incidents, and notifies you when issues resolve — automatically.

## ✨ Features

- **Unified API** — `logger.error('msg', error, { fields })` routes to every configured adapter
- **Exponential suppression** — alerts fire at 1, 2, 4, 8, 16, 32, 64... then switch to periodic digests
- **Resolution detection** — get a "resolved" message when an error stops occurring
- **Error fingerprinting** — same bug from different requests groups automatically (strips IDs, timestamps, UUIDs)
- **Multi-channel routing** — route by severity level or custom tags to different channels
- **Adapter architecture** — Discord, Slack, Telegram, and Console built-in; or build your own
- **NestJS integration** — drop-in `@Global()` module with automatic exception filter
- **NextJS integration** — `instrumentation.ts` hook with automatic `onRequestError` handler
- **Per-environment config** — different suppression thresholds, levels, and ping rules for prod/staging/dev
- **Environment badges** — `[PROD]`, `[STG]`, `[DEV]` prefix on every alert so you never confuse environments
- **Request context (NestJS)** — auto-attaches request ID, method, path via `AsyncLocalStorage`
- **Rate-limit aware** — respects per-adapter limits, queues on failure, drains on recovery
- **Zero framework deps in core** — just `node:crypto` and `fetch`

## 📦 Install

```bash
npm install @iqai/alert-logger
# or
pnpm add @iqai/alert-logger
# or
yarn add @iqai/alert-logger
```

## 🚀 Quick Start

### Standalone (any Node.js project)

```ts
import { AlertLogger, DiscordAdapter, SlackAdapter, TelegramAdapter } from '@iqai/alert-logger'

const logger = AlertLogger.init({
  adapters: [
    new DiscordAdapter({
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      channels: { critical: process.env.DISCORD_ONCALL_WEBHOOK },
      mentions: { critical: ['<@&oncall-role>'] },
    }),
    new SlackAdapter({
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      mentions: { critical: ['<@U0123ONCALL>'] },
    }),
    new TelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      topics: { critical: 42, warning: 43, info: 44 },
    }),
  ],
  serviceName: 'my-service',
})

// Simple error — goes to all adapters with full context
logger.error('Payment failed', error)

// With metadata
logger.error('Payment failed', error, {
  fields: { orderId: 'abc', amount: '$50' },
  tags: ['billing'],
})

// Warning
logger.warn('Queue depth high', { fields: { depth: 150 } })

// Info
logger.info('Deployment complete', { fields: { version: '1.2.3' } })
```

### NestJS

```bash
npm install @iqai/alert-logger @nestjs/common @nestjs/config
```

```ts
// app.module.ts
import { AlertLoggerModule } from '@iqai/alert-logger/nestjs'
import { DiscordAdapter } from '@iqai/alert-logger'

@Module({
  imports: [
    AlertLoggerModule.forRoot({
      adapters: [
        new DiscordAdapter({ webhookUrl: process.env.DISCORD_WEBHOOK_URL }),
      ],
      serviceName: 'backend',
    }),
  ],
})
export class AppModule {}
```

```ts
// any.service.ts — AlertLoggerService is globally available
import { AlertLoggerService } from '@iqai/alert-logger/nestjs'

@Injectable()
export class PaymentService {
  constructor(private readonly alert: AlertLoggerService) {}

  async charge(order: Order) {
    try {
      await this.process(order)
    } catch (error) {
      this.alert.error('Payment failed', error, {
        fields: { orderId: order.id, amount: order.total },
      })
      throw error
    }
  }
}
```

Unhandled 5xx errors are caught automatically by the built-in global exception filter — no extra code needed.

### NextJS

```bash
npm install @iqai/alert-logger next
```

```ts
// instrumentation.ts
import { createAlertLoggerHandler, captureRequestError } from '@iqai/alert-logger/nextjs'
import { DiscordAdapter } from '@iqai/alert-logger'

export function register() {
  createAlertLoggerHandler({
    adapters: [
      new DiscordAdapter({ webhookUrl: process.env.DISCORD_WEBHOOK_URL }),
    ],
    serviceName: 'frontend',
  })
}

export { captureRequestError as onRequestError }
```

That's it. All server-side errors (API routes, server components, server actions) are captured automatically.

## 🧠 How Aggregation Works

When the same error fires repeatedly, the library doesn't spam your channel:

| Phase | Trigger | What gets sent |
|-------|---------|----------------|
| **Onset** | 1st occurrence | Full alert with stack trace, fields, tags |
| **Ramp** | 2nd, 4th, 8th, 16th, 32nd, 64th | Compact: `"Payment failed (x8 — 4 suppressed)"` |
| **Sustained** | >64 in window | Digest every 5min: `"x4,812 in last 5m"` |
| **Resolution** | 0 hits for 2min | `"Resolved: Payment failed — 12,847 total over 23m"` |

Errors are grouped by **fingerprint** — the library strips variable parts (IDs, timestamps, UUIDs, hex addresses) from the error message and hashes it with the top stack frames. Same bug, different request = same group.

## 🌍 Per-Environment Config

Same codebase, different behavior per environment. Dev won't bug you as much as prod:

```ts
AlertLogger.init({
  adapters: [new DiscordAdapter({ webhookUrl: '...' })],
  environment: process.env.NODE_ENV,
  environments: {
    production: {
      levels: ['warning', 'critical'],
      aggregation: { digestIntervalMs: 5 * 60_000 },
    },
    staging: {
      levels: ['critical'],           // only errors, no warnings
      aggregation: { digestIntervalMs: 15 * 60_000 },
    },
    development: {
      levels: ['critical'],
      aggregation: { rampThreshold: 8, digestIntervalMs: 30 * 60_000 },
    },
  },
})
```

Every alert is prefixed with an environment badge (`[PROD]`, `[STG]`, `[DEV]`) so you never mistake staging for production.

## 📡 Multi-Channel Routing

Each adapter owns its routing. Route alerts to different channels/topics by severity or tags:

```ts
AlertLogger.init({
  adapters: [
    // Discord: route by level to different webhook URLs
    new DiscordAdapter({
      webhookUrl: process.env.DISCORD_DEFAULT_WEBHOOK,
      channels: {
        critical: process.env.DISCORD_ONCALL_WEBHOOK,
        warning: process.env.DISCORD_WARNINGS_WEBHOOK,
      },
      tags: {
        indexer: process.env.DISCORD_INDEXER_WEBHOOK,
      },
      mentions: {
        critical: ['<@&oncall-role>'],
      },
    }),

    // Slack: same pattern with Incoming Webhook URLs
    new SlackAdapter({
      webhookUrl: process.env.SLACK_DEFAULT_WEBHOOK,
      channels: {
        critical: process.env.SLACK_ONCALL_WEBHOOK,
      },
      mentions: {
        critical: ['<@U0123ONCALL>'],
      },
    }),

    // Telegram: route by level to forum topics
    new TelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      topics: {
        critical: 42,
        warning: 43,
        info: 44,
      },
      tags: {
        indexer: 99,
      },
      mentions: {
        critical: ['@oncall_dev'],
      },
    }),
  ],
})
```

## 🔌 Custom Adapters

Implement the `AlertAdapter` interface to send alerts anywhere:

```ts
import { AlertAdapter, FormattedAlert, AlertLevel } from '@iqai/alert-logger'

class PagerDutyAdapter implements AlertAdapter {
  readonly name = 'pagerduty'
  levels: AlertLevel[] = ['critical']

  rateLimits() {
    return { maxPerWindow: 60, windowMs: 60_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    // POST to PagerDuty Events API
  }
}
```

## ⚙️ Full Configuration

```ts
AlertLogger.init({
  // Required — each adapter configures its own routing
  adapters: [
    new DiscordAdapter({
      webhookUrl: '...',
      channels: {},                // level → webhook URL
      tags: {},                    // tag → webhook URL
      mentions: {},                // level → mention strings
    }),
  ],

  // Identity
  serviceName: 'backend',         // defaults to hostname
  environment: 'production',      // attached to every alert

  // Aggregation tuning
  aggregation: {
    rampThreshold: 64,             // switch from ramp to digest phase
    digestIntervalMs: 5 * 60_000,  // how often to send digests
    resolutionCooldownMs: 2 * 60_000, // silence before "resolved"
  },

  // Per-environment overrides
  environments: {
    production: { levels: ['warning', 'critical'] },
    staging: { levels: ['critical'] },
    development: { levels: ['critical'], aggregation: { rampThreshold: 8 } },
  },

  // Reliability
  queue: {
    maxSize: 500,                  // retry buffer size
    persistPath: null,             // optional disk persistence
  },

  // Fingerprinting
  fingerprint: {
    stackDepth: 3,                 // stack frames to hash
    normalizers: [],               // custom regex replacements
  },
})
```

## 🧩 Adapters Ecosystem

| Adapter | Package | Status |
|---------|---------|--------|
| Discord | `@iqai/alert-logger` (built-in) | Available |
| Slack | `@iqai/alert-logger` (built-in) | Available |
| Telegram | `@iqai/alert-logger` (built-in) | Available |
| Console | `@iqai/alert-logger` (built-in) | Available |
| Sentry | `@iqai/alert-logger-sentry` | Planned |

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT
