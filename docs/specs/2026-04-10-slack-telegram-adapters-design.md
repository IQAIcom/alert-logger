# Slack & Telegram Adapters Design

## Goal

Add Slack and Telegram adapters to `@iqai/alert-logger`, following the same patterns as the existing Discord adapter. Each adapter owns its own routing (per-level channels/topics, per-tag overrides, mentions).

## Breaking Changes

This design moves routing from the global `AlertLoggerConfig.routing` into individual adapter constructors. The global `RoutingConfig` type, the `Router` class, and the `webhookUrl`/`pings` fields on `FormattedAlert` are removed.

**Migration path:** Move `routing.channels`, `routing.tags`, and `routing.pings` into `DiscordAdapterOptions`.

Before:
```ts
AlertLogger.init({
  adapters: [new DiscordAdapter({ webhookUrl: '...' })],
  routing: {
    channels: { critical: 'https://discord.com/.../critical' },
    pings: { critical: ['<@&role>'] },
  },
})
```

After:
```ts
AlertLogger.init({
  adapters: [
    new DiscordAdapter({
      webhookUrl: '...',
      channels: { critical: 'https://discord.com/.../critical' },
      mentions: { critical: ['<@&role>'] },
    }),
  ],
})
```

## Adapter Configs

### SlackAdapter

```ts
interface SlackAdapterOptions {
  /** Default Incoming Webhook URL */
  webhookUrl: string
  /** Override webhook URL per alert level */
  channels?: Partial<Record<AlertLevel, string>>
  /** Override webhook URL per tag */
  tags?: Record<string, string>
  /** Slack user/group mentions per level, e.g. ["<@U0123>", "<!subteam^S456>"] */
  mentions?: Partial<Record<AlertLevel, string[]>>
}
```

- Uses Slack Incoming Webhooks (no bot token, no OAuth).
- `channels` and `tags` values are webhook URLs (each Slack webhook maps to one channel).
- Rate limit: 1 request/sec per webhook.

### TelegramAdapter

```ts
interface TelegramAdapterOptions {
  /** Telegram Bot API token */
  botToken: string
  /** Target chat ID (group or channel) */
  chatId: string
  /** Map alert level to a forum topic (message_thread_id) */
  topics?: Partial<Record<AlertLevel, number>>
  /** Map tag to a forum topic */
  tags?: Record<string, number>
  /** Telegram @username mentions per level */
  mentions?: Partial<Record<AlertLevel, string[]>>
}
```

- Uses the Telegram Bot HTTP API (`sendMessage` endpoint).
- Single group chat with forum topics for per-level routing.
- Rate limit: 20 messages/60s per chat.

### DiscordAdapter (updated)

```ts
interface DiscordAdapterOptions {
  /** Default webhook URL */
  webhookUrl: string
  /** Override webhook URL per alert level */
  channels?: Partial<Record<AlertLevel, string>>
  /** Override webhook URL per tag */
  tags?: Record<string, string>
  /** Discord user/role mentions per level, e.g. ["<@123>", "<@&456>"] */
  mentions?: Partial<Record<AlertLevel, string[]>>
}
```

- Gains `channels`, `tags`, `mentions` (previously in global `routing` config).
- Existing `webhookUrl` remains the default destination.

## Internal Routing

Each adapter implements a private `resolve(level, tags?)` method that returns the destination + mentions:

- **Discord/Slack:** Returns `{ url: string; mentions: string[] }` — checks tags first, then level, then falls back to the default webhook URL.
- **Telegram:** Returns `{ topicId?: number; mentions: string[] }` — checks tags first, then level. No topic = posts to general chat.

This replaces the current `Router` class and the `webhookUrl`/`pings` fields on `FormattedAlert`.

## Message Formatting

Each adapter has its own `formatter.ts` that handles the 4 aggregation phases (onset, ramp, sustained, resolution).

### Slack Formatter

Uses Block Kit with attachments for color coding:

- **Color bar:** `attachment.color` hex — blue `#3498db` (info), yellow `#f39c12` (warning), red `#e74c3c` (critical), green `#2ecc71` (resolution).
- **Title:** Header block — `[PROD] [CRITICAL] Alert title`.
- **Body:** Section block with `mrkdwn` — alert message, stack traces in triple-backtick code blocks.
- **Fields:** Section fields as `mrkdwn` key/value pairs with `inline: true` equivalent (short fields).
- **Footer:** Context block — service name + timestamp.
- **Mentions:** Plain text block above the attachment (like Discord's `content` field).

Phase-specific formatting mirrors the Discord formatter (onset shows full detail, ramp/sustained show counts, resolution shows totals).

### Telegram Formatter

Uses HTML parse mode (`parse_mode: "HTML"`):

- **Severity indicator:** Emoji prefix — blue circle (info), warning triangle (warning), red circle (critical), green checkmark (resolution).
- **Title:** `<b>[PROD] [CRITICAL] Alert title</b>`.
- **Body:** Alert message as plain text. Stack traces in `<code>` blocks.
- **Fields:** Key-value list — `<b>key:</b> value`.
- **Footer:** `<i>Service: name | timestamp</i>`.
- **Mentions:** `@username` inline in the message.
- **Limit:** 4096 characters per message — truncate with ellipsis.

## Rate Limits & Retry

| Adapter  | maxPerWindow | windowMs | Retry Strategy                              |
|----------|-------------|----------|---------------------------------------------|
| Discord  | 30          | 60000    | Retry on 429, `Retry-After` header (secs)   |
| Slack    | 1           | 1000     | Retry on 429, `Retry-After` header (secs)   |
| Telegram | 20          | 60000    | Retry on 429, `retry_after` in JSON body     |

All three retry up to 2 times on 429 responses, reading the service-specific retry-after value.

## Core Type Changes

### FormattedAlert

Remove `webhookUrl` and `pings`:

```ts
interface FormattedAlert extends Alert {
  aggregation: AggregationMeta
  environmentBadge: string
  // webhookUrl and pings removed — adapters resolve these internally
}
```

### AlertLoggerConfig

Remove `routing`:

```ts
interface AlertLoggerConfig {
  adapters: AlertAdapter[]
  serviceName?: string
  environment?: string
  aggregation?: Partial<AggregationConfig>
  // routing removed — each adapter owns its routing
  environments?: Record<string, EnvironmentConfig>
  queue?: Partial<QueueConfig>
  health?: Partial<HealthPolicy>
  fingerprint?: Partial<FingerprintConfig>
}
```

### EnvironmentConfig

Remove `pings` field (was per-environment ping overrides — now handled by adapter config):

```ts
interface EnvironmentConfig {
  levels?: AlertLevel[]
  aggregation?: Partial<AggregationConfig>
  // pings removed
}
```

### Router class

Removed entirely. Each adapter resolves destinations internally.

### ResolvedConfig

Remove `routing` and `pings` fields.

## File Structure

```
src/adapters/
  console/
    console-adapter.ts            (unchanged)
  discord/
    discord-adapter.ts            (add routing, remove webhookUrl dependency)
    discord-adapter.test.ts       (update tests)
    formatter.ts                  (unchanged)
    formatter.test.ts             (unchanged)
  slack/
    slack-adapter.ts              (new)
    slack-adapter.test.ts         (new)
    formatter.ts                  (new)
    formatter.test.ts             (new)
  telegram/
    telegram-adapter.ts           (new)
    telegram-adapter.test.ts      (new)
    formatter.ts                  (new)
    formatter.test.ts             (new)
```

## Exports

Add to `src/index.ts`:

```ts
export { SlackAdapter } from './adapters/slack/slack-adapter.js'
export type { SlackAdapterOptions } from './adapters/slack/slack-adapter.js'
export { TelegramAdapter } from './adapters/telegram/telegram-adapter.js'
export type { TelegramAdapterOptions } from './adapters/telegram/telegram-adapter.js'
```

No changes to `tsup.config.ts` — adapters are part of the main entry point.

## Testing

Same pattern as `discord-adapter.test.ts`:

- Mock `fetch` globally with `vi.stubGlobal`.
- Test `send()` posts correct payload to correct URL/endpoint.
- Test routing: level-based, tag-based, default fallback.
- Test mentions appear in correct location.
- Test 429 retry logic with service-specific retry-after parsing.
- Test non-429 error throws.
- Test `rateLimits()` returns expected values.
- Formatter tests cover all 4 phases, truncation, and sanitization.

## Usage Example

```ts
import { AlertLogger, DiscordAdapter, SlackAdapter, TelegramAdapter } from '@iqai/alert-logger'

const logger = AlertLogger.init({
  serviceName: 'my-api',
  adapters: [
    new DiscordAdapter({
      webhookUrl: 'https://discord.com/api/webhooks/default',
      channels: { critical: 'https://discord.com/api/webhooks/critical' },
      mentions: { critical: ['<@&oncall-role>'] },
    }),
    new SlackAdapter({
      webhookUrl: 'https://hooks.slack.com/services/T.../B.../default',
      channels: { critical: 'https://hooks.slack.com/services/T.../B.../critical' },
      mentions: { critical: ['<@U0123ONCALL>'] },
    }),
    new TelegramAdapter({
      botToken: '123456:ABC-DEF...',
      chatId: '-1001234567890',
      topics: { critical: 42, warning: 43, info: 44 },
      mentions: { critical: ['@oncall_dev'] },
    }),
  ],
})

logger.error('Database connection lost', new Error('ECONNREFUSED'))
```
