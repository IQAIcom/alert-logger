---
"@iqai/alert-logger": major
---

Add Slack and Telegram adapters with adapter-owned routing

**Breaking changes:**
- Removed `RoutingConfig` type, `Router` class, and `routing` option from `AlertLoggerConfig`
- Removed `webhookUrl` and `pings` from `FormattedAlert`
- Removed `pings` from `EnvironmentConfig`
- Routing is now configured per-adapter via `channels`, `tags`, and `mentions` constructor options

**Migration:** Move `routing.channels`, `routing.tags`, and `routing.pings` into your adapter constructor:

```ts
// Before
AlertLogger.init({
  adapters: [new DiscordAdapter({ webhookUrl: '...' })],
  routing: {
    channels: { critical: '...' },
    pings: { critical: ['<@&role>'] },
  },
})

// After
AlertLogger.init({
  adapters: [
    new DiscordAdapter({
      webhookUrl: '...',
      channels: { critical: '...' },
      mentions: { critical: ['<@&role>'] },
    }),
  ],
})
```

**New features:**
- `SlackAdapter` — Incoming Webhooks with Block Kit formatting, per-level channel routing, mention support, mrkdwn sanitization
- `TelegramAdapter` — Bot API with HTML formatting, per-level forum topic routing, tag-to-topic mapping, @username mentions, safe HTML truncation
