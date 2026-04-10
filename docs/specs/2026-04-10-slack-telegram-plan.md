# Slack & Telegram Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slack and Telegram adapters with adapter-owned routing, removing the global `RoutingConfig`/`Router` in favor of per-adapter `channels`/`tags`/`mentions` config.

**Architecture:** Each adapter owns its routing via a private `resolve()` method. Core types (`FormattedAlert`, `AlertLoggerConfig`) are simplified by removing `webhookUrl`, `pings`, `routing`. New formatters use Slack Block Kit and Telegram HTML respectively.

**Tech Stack:** TypeScript, vitest, tsup, native `fetch`

---

### Task 1: Remove global routing from core types

**Files:**
- Modify: `src/core/types.ts`
- Delete: `src/core/router.ts`
- Delete: `src/core/router.test.ts`
- Modify: `src/core/alert-logger.ts`
- Modify: `src/index.ts` (remove `RoutingConfig` export)

- [ ] **Step 1: Update `src/core/types.ts`**

Remove `RoutingConfig` interface, remove `routing` from `AlertLoggerConfig`, remove `pings` from `EnvironmentConfig`, remove `routing`/`pings` from `ResolvedConfig`, remove `webhookUrl`/`pings` from `FormattedAlert`, update `resolveConfig()`:

```ts
// DELETE the entire RoutingConfig interface:
// export interface RoutingConfig {
//   channels?: Partial<Record<AlertLevel, string>>
//   tags?: Record<string, string>
//   pings?: Partial<Record<AlertLevel, string[]>>
// }

// FormattedAlert — remove webhookUrl and pings:
export interface FormattedAlert extends Alert {
  aggregation: AggregationMeta
  environmentBadge: string
}

// EnvironmentConfig — remove pings:
export interface EnvironmentConfig {
  levels?: AlertLevel[]
  aggregation?: Partial<AggregationConfig>
}

// AlertLoggerConfig — remove routing:
export interface AlertLoggerConfig {
  adapters: AlertAdapter[]
  serviceName?: string
  environment?: string
  aggregation?: Partial<AggregationConfig>
  environments?: Record<string, EnvironmentConfig>
  queue?: Partial<QueueConfig>
  health?: Partial<HealthPolicy>
  fingerprint?: Partial<FingerprintConfig>
}

// ResolvedConfig — remove routing and pings:
export interface ResolvedConfig {
  adapters: AlertAdapter[]
  serviceName: string
  environment: string
  aggregation: AggregationConfig
  queue: QueueConfig
  health: HealthPolicy
  fingerprint: FingerprintConfig
  levels: AlertLevel[]
  environmentBadge: string
}

// resolveConfig — remove pings/routing construction:
export function resolveConfig(config: AlertLoggerConfig): ResolvedConfig {
  const environment = config.environment ?? process.env.NODE_ENV ?? 'production'
  const envOverride = config.environments?.[environment]

  const aggregation: AggregationConfig = {
    ...DEFAULT_AGGREGATION,
    ...config.aggregation,
    ...envOverride?.aggregation,
  }

  const levels: AlertLevel[] = envOverride?.levels ?? ['info', 'warning', 'critical']

  return {
    adapters: config.adapters,
    serviceName: config.serviceName ?? 'unknown',
    environment,
    aggregation,
    queue: { ...DEFAULT_QUEUE, ...config.queue },
    health: { ...DEFAULT_HEALTH, ...config.health },
    fingerprint: { ...DEFAULT_FINGERPRINT, ...config.fingerprint },
    levels,
    environmentBadge: BADGE_MAP[environment] ?? `[${environment.toUpperCase()}]`,
  }
}
```

- [ ] **Step 2: Delete `src/core/router.ts` and `src/core/router.test.ts`**

```bash
rm src/core/router.ts src/core/router.test.ts
```

- [ ] **Step 3: Update `src/core/alert-logger.ts`**

Remove Router import, remove `router` field, remove Router instantiation, remove `webhookUrl`/`pings` from all `FormattedAlert` objects:

```ts
// DELETE these lines:
// import { Router } from './router.js'
// private readonly router: Router
// this.router = new Router(config.routing, config.pings)

// In the log() method, remove:
//   const routing = this.router.route(level, opts.tags)
// And remove from the FormattedAlert literal:
//   webhookUrl: routing.webhookUrl,
//   pings: routing.pings,

// In handleResolution(), remove from FormattedAlert:
//   pings: [],

// In handleAdapterRecovery(), remove from FormattedAlert:
//   pings: [],
```

The `log()` method's FormattedAlert construction becomes:
```ts
const formatted: FormattedAlert = {
  level,
  title,
  message,
  error,
  options: opts,
  timestamp: Date.now(),
  serviceName: this.config.serviceName,
  environment: this.config.environment,
  aggregation: {
    phase: result.phase,
    fingerprint: fp,
    count: result.count,
    suppressedSince: result.suppressedSince,
    firstSeen: result.firstSeen,
    lastSeen: result.lastSeen,
    peakRate: result.peakRate,
  },
  environmentBadge: this.config.environmentBadge,
}
```

- [ ] **Step 4: Remove `RoutingConfig` from `src/index.ts` exports**

Remove `RoutingConfig` from the type export block.

- [ ] **Step 5: Fix all test files that reference `pings` or `webhookUrl` on `FormattedAlert`**

Files to update (remove `pings: []` and any `webhookUrl` from alert object literals):
- `src/adapters/discord/discord-adapter.test.ts` — remove `pings: []` from `makeAlert`, remove the "includes pings as content field" test (will be replaced in Task 2)
- `src/adapters/discord/formatter.test.ts` — remove `pings: []` from `makeAlert`
- `src/core/health-manager.test.ts` — remove `pings: []` from `createAlert`
- `src/core/queue-persistence.test.ts` — remove `pings: []` from `makeEntry`
- `src/core/retry-queue.test.ts` — remove `pings: []` from `makeEntry`
- `src/core/alert-logger.test.ts` — no changes needed (MockAdapter receives FormattedAlert, doesn't construct it)

- [ ] **Step 6: Run tests to verify**

```bash
pnpm test
```

Expected: All tests pass (except the deleted router tests which are gone).

- [ ] **Step 7: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor!: remove global RoutingConfig in favor of adapter-owned routing

BREAKING CHANGE: RoutingConfig, Router, and webhookUrl/pings on
FormattedAlert are removed. Routing is now configured per-adapter
via channels/tags/mentions options."
```

---

### Task 2: Add internal routing to DiscordAdapter

**Files:**
- Modify: `src/adapters/discord/discord-adapter.ts`
- Modify: `src/adapters/discord/discord-adapter.test.ts`

- [ ] **Step 1: Write failing tests for Discord routing and mentions**

Add these tests to `src/adapters/discord/discord-adapter.test.ts`:

```ts
it('send() uses default webhookUrl when no routing matches', async () => {
  mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

  adapter = new DiscordAdapter({ webhookUrl: WEBHOOK_URL })
  await adapter.send(makeAlert())

  const [url] = mockFetch.mock.calls[0]
  expect(url).toBe(WEBHOOK_URL)
})

it('send() routes to level-specific channel', async () => {
  mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

  const criticalUrl = 'https://discord.com/api/webhooks/999/critical'
  adapter = new DiscordAdapter({
    webhookUrl: WEBHOOK_URL,
    channels: { critical: criticalUrl },
  })
  await adapter.send(makeAlert({ level: 'critical' }))

  const [url] = mockFetch.mock.calls[0]
  expect(url).toBe(criticalUrl)
})

it('send() routes to tag-specific channel with priority over level', async () => {
  mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

  const paymentsUrl = 'https://discord.com/api/webhooks/999/payments'
  const criticalUrl = 'https://discord.com/api/webhooks/999/critical'
  adapter = new DiscordAdapter({
    webhookUrl: WEBHOOK_URL,
    channels: { critical: criticalUrl },
    tags: { payments: paymentsUrl },
  })
  await adapter.send(makeAlert({ level: 'critical', options: { tags: ['payments'] } }))

  const [url] = mockFetch.mock.calls[0]
  expect(url).toBe(paymentsUrl)
})

it('send() includes mentions as content field', async () => {
  mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

  adapter = new DiscordAdapter({
    webhookUrl: WEBHOOK_URL,
    mentions: { critical: ['<@123>', '<@&456>'] },
  })
  await adapter.send(makeAlert({ level: 'critical' }))

  const body = JSON.parse(mockFetch.mock.calls[0][1].body)
  expect(body.content).toBe('<@123> <@&456>')
})

it('send() omits content when no mentions for level', async () => {
  mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

  adapter = new DiscordAdapter({
    webhookUrl: WEBHOOK_URL,
    mentions: { critical: ['<@123>'] },
  })
  await adapter.send(makeAlert({ level: 'info' }))

  const body = JSON.parse(mockFetch.mock.calls[0][1].body)
  expect(body.content).toBeUndefined()
})
```

Also remove the old `send() uses alert.webhookUrl override when present` and `send() includes pings as content field` tests since those relied on `alert.webhookUrl` and `alert.pings`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/adapters/discord/discord-adapter.test.ts
```

Expected: New tests fail (DiscordAdapter doesn't accept channels/tags/mentions yet).

- [ ] **Step 3: Update `src/adapters/discord/discord-adapter.ts`**

```ts
import type { AlertAdapter, AlertLevel, FormattedAlert } from '../../core/types.js'
import { formatDiscordEmbed } from './formatter.js'

export interface DiscordAdapterOptions {
  webhookUrl: string
  channels?: Partial<Record<AlertLevel, string>>
  tags?: Record<string, string>
  mentions?: Partial<Record<AlertLevel, string[]>>
}

export class DiscordAdapter implements AlertAdapter {
  readonly name = 'discord' as const
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  private readonly webhookUrl: string
  private readonly channels: Partial<Record<AlertLevel, string>>
  private readonly tags: Record<string, string>
  private readonly mentions: Partial<Record<AlertLevel, string[]>>

  constructor(options: DiscordAdapterOptions) {
    this.webhookUrl = options.webhookUrl
    this.channels = options.channels ?? {}
    this.tags = options.tags ?? {}
    this.mentions = options.mentions ?? {}
  }

  rateLimits() {
    return { maxPerWindow: 30, windowMs: 60_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    const embed = formatDiscordEmbed(alert)
    const { url, mentions } = this.resolve(alert.level, alert.options.tags)

    const payload: Record<string, unknown> = { embeds: [embed] }

    if (mentions.length > 0) {
      payload.content = mentions.join(' ')
    }

    await this.postWebhook(url, payload)
  }

  async healthy(): Promise<boolean> {
    return true
  }

  private resolve(
    level: AlertLevel,
    tags?: string[],
  ): { url: string; mentions: string[] } {
    const mentions = this.mentions[level] ?? []

    if (tags?.length) {
      for (const tag of tags) {
        const url = this.tags[tag]
        if (url) return { url, mentions }
      }
    }

    const levelUrl = this.channels[level]
    if (levelUrl) return { url: levelUrl, mentions }

    return { url: this.webhookUrl, mentions }
  }

  private async postWebhook(
    url: string,
    body: Record<string, unknown>,
    retryCount = 0,
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (response.status === 429 && retryCount < 2) {
      const retryAfter = Number(response.headers.get('Retry-After')) || 1
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      return this.postWebhook(url, body, retryCount + 1)
    }

    if (!response.ok) {
      throw new Error(`Discord webhook returned ${response.status}: ${await response.text()}`)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/adapters/discord/discord-adapter.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/discord/
git commit -m "feat: add internal routing to DiscordAdapter (channels/tags/mentions)"
```

---

### Task 3: Slack formatter

**Files:**
- Create: `src/adapters/slack/formatter.ts`
- Create: `src/adapters/slack/formatter.test.ts`

- [ ] **Step 1: Write failing tests for Slack formatter**

Create `src/adapters/slack/formatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { FormattedAlert } from '../../core/types.js'
import { formatSlackPayload } from './formatter.js'

function makeAlert(overrides: Partial<FormattedAlert> = {}): FormattedAlert {
  return {
    level: 'critical',
    title: 'Test Error',
    message: 'Something failed',
    options: {},
    timestamp: Date.now(),
    serviceName: 'test-service',
    environment: 'production',
    aggregation: {
      phase: 'onset',
      fingerprint: 'abc123',
      count: 1,
      suppressedSince: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      peakRate: 0,
    },
    environmentBadge: '[PROD]',
    ...overrides,
  }
}

describe('formatSlackPayload', () => {
  describe('onset phase', () => {
    it('includes badge, level, and title in the header block', () => {
      const alert = makeAlert()
      const payload = formatSlackPayload(alert)
      const header = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'header',
      )
      expect(header.text.text).toContain('[PROD]')
      expect(header.text.text).toContain('[CRITICAL]')
      expect(header.text.text).toContain('Test Error')
    })

    it('includes message in a section block', () => {
      const alert = makeAlert({ message: 'Database connection lost' })
      const payload = formatSlackPayload(alert)
      const section = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'section' && b.text,
      )
      expect(section.text.text).toContain('Database connection lost')
    })

    it('includes stack trace in a code block', () => {
      const error = new Error('boom')
      error.stack = 'Error: boom\n  at foo.ts:1'
      const alert = makeAlert({ error })
      const payload = formatSlackPayload(alert)
      const section = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'section' && b.text,
      )
      expect(section.text.text).toContain('```')
      expect(section.text.text).toContain('Error: boom')
    })

    it('maps alert options.fields to section fields', () => {
      const alert = makeAlert({
        options: { fields: { userId: '42', region: 'us-east-1' } },
      })
      const payload = formatSlackPayload(alert)
      const fieldSection = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'section' && b.fields,
      )
      expect(fieldSection.fields).toHaveLength(2)
      expect(fieldSection.fields[0].text).toContain('userId')
      expect(fieldSection.fields[0].text).toContain('42')
    })

    it('includes service name in context block', () => {
      const alert = makeAlert()
      const payload = formatSlackPayload(alert)
      const context = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'context',
      )
      expect(context.elements[0].text).toContain('test-service')
    })
  })

  describe('ramp phase', () => {
    it('includes count and suppressed count in the header', () => {
      const alert = makeAlert({
        aggregation: {
          phase: 'ramp',
          fingerprint: 'abc123',
          count: 10,
          suppressedSince: 5,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          peakRate: 0,
        },
      })
      const payload = formatSlackPayload(alert)
      const header = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'header',
      )
      expect(header.text.text).toContain('x10')
      expect(header.text.text).toContain('5 suppressed')
    })
  })

  describe('sustained phase', () => {
    it('includes count and peak rate in the header', () => {
      const alert = makeAlert({
        aggregation: {
          phase: 'sustained',
          fingerprint: 'abc123',
          count: 200,
          suppressedSince: 0,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          peakRate: 3.7,
        },
      })
      const payload = formatSlackPayload(alert)
      const header = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'header',
      )
      expect(header.text.text).toContain('x200')
      expect(header.text.text).toContain('3.7/s')
    })
  })

  describe('resolution phase', () => {
    it('starts with checkmark and includes total count', () => {
      const now = Date.now()
      const alert = makeAlert({
        aggregation: {
          phase: 'resolution',
          fingerprint: 'abc123',
          count: 50,
          suppressedSince: 0,
          firstSeen: now - 3_600_000,
          lastSeen: now,
          peakRate: 0,
        },
      })
      const payload = formatSlackPayload(alert)
      const header = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'header',
      )
      expect(header.text.text).toMatch(/^\u2705/)
      expect(header.text.text).toContain('50 total')
    })

    it('uses green color', () => {
      const alert = makeAlert({
        aggregation: {
          phase: 'resolution',
          fingerprint: 'abc123',
          count: 1,
          suppressedSince: 0,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          peakRate: 0,
        },
      })
      const payload = formatSlackPayload(alert)
      expect(payload.attachments[0].color).toBe('#2ecc71')
    })
  })

  describe('severity colors', () => {
    it('uses blue for info', () => {
      const alert = makeAlert({ level: 'info' })
      const payload = formatSlackPayload(alert)
      expect(payload.attachments[0].color).toBe('#3498db')
    })

    it('uses orange for warning', () => {
      const alert = makeAlert({ level: 'warning' })
      const payload = formatSlackPayload(alert)
      expect(payload.attachments[0].color).toBe('#f39c12')
    })

    it('uses red for critical', () => {
      const alert = makeAlert({ level: 'critical' })
      const payload = formatSlackPayload(alert)
      expect(payload.attachments[0].color).toBe('#e74c3c')
    })
  })

  describe('truncation', () => {
    it('truncates long titles to 150 characters', () => {
      const alert = makeAlert({ title: 'A'.repeat(200) })
      const payload = formatSlackPayload(alert)
      const header = payload.attachments[0].blocks.find(
        (b: any) => b.type === 'header',
      )
      expect(header.text.text.length).toBeLessThanOrEqual(150)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/adapters/slack/formatter.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement Slack formatter**

Create `src/adapters/slack/formatter.ts`:

```ts
import type { FormattedAlert } from '../../core/types.js'
import { formatDuration } from '../../core/utils.js'

const SEVERITY_COLORS: Record<string, string> = {
  info: '#3498db',
  warning: '#f39c12',
  critical: '#e74c3c',
}

const RESOLUTION_COLOR = '#2ecc71'

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  fields?: Array<{ type: string; text: string }>
  elements?: Array<{ type: string; text: string }>
}

export interface SlackPayload {
  attachments: Array<{
    color: string
    blocks: SlackBlock[]
  }>
}

export function formatSlackPayload(alert: FormattedAlert): SlackPayload {
  const { aggregation } = alert
  const phase = aggregation.phase

  const color =
    phase === 'resolution'
      ? RESOLUTION_COLOR
      : (SEVERITY_COLORS[alert.level] ?? SEVERITY_COLORS.info)

  const blocks: SlackBlock[] = []

  switch (phase) {
    case 'onset': {
      const title = truncate(
        `${alert.environmentBadge} [${alert.level.toUpperCase()}] ${alert.title}`,
        150,
      )
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: title },
      })

      let body = alert.message
      if (alert.error?.stack) {
        body += `\n\n\`\`\`\n${alert.error.stack}\n\`\`\``
      }
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: truncate(body, 3000) },
      })

      if (alert.options.fields) {
        const fields = Object.entries(alert.options.fields).map(
          ([key, value]) => ({
            type: 'mrkdwn' as const,
            text: `*${key}:* ${value}`,
          }),
        )
        if (fields.length > 0) {
          blocks.push({ type: 'section', fields })
        }
      }
      break
    }

    case 'ramp': {
      const title = truncate(
        `${alert.environmentBadge} [${alert.level.toUpperCase()}] ${alert.title} (x${aggregation.count} \u2014 ${aggregation.suppressedSince} suppressed since last)`,
        150,
      )
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: title },
      })
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: truncate(alert.message, 3000) },
      })
      break
    }

    case 'sustained': {
      const title = truncate(
        `${alert.environmentBadge} [${alert.level.toUpperCase()}] ${alert.title} (x${aggregation.count} \u00B7 peak: ${aggregation.peakRate.toFixed(1)}/s)`,
        150,
      )
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: title },
      })
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: truncate(alert.message, 3000) },
      })
      break
    }

    case 'resolution': {
      const totalDuration = formatDuration(
        aggregation.lastSeen - aggregation.firstSeen,
      )
      const title = truncate(
        `\u2705 Resolved: ${alert.title} \u2014 ${aggregation.count} total over ${totalDuration}`,
        150,
      )
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: title },
      })
      break
    }
  }

  // Context block with service name and timestamp
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Service: ${alert.serviceName} | ${new Date(alert.timestamp).toISOString()}`,
      },
    ],
  })

  return {
    attachments: [{ color, blocks }],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/adapters/slack/formatter.test.ts
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/slack/
git commit -m "feat: add Slack message formatter with Block Kit"
```

---

### Task 4: Slack adapter

**Files:**
- Create: `src/adapters/slack/slack-adapter.ts`
- Create: `src/adapters/slack/slack-adapter.test.ts`

- [ ] **Step 1: Write failing tests for Slack adapter**

Create `src/adapters/slack/slack-adapter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormattedAlert } from '../../core/types.js'
import { SlackAdapter } from './slack-adapter.js'

function makeAlert(overrides: Partial<FormattedAlert> = {}): FormattedAlert {
  return {
    level: 'critical',
    title: 'Test Alert',
    message: 'Something went wrong',
    options: {},
    timestamp: Date.now(),
    serviceName: 'test-service',
    environment: 'production',
    aggregation: {
      phase: 'onset',
      fingerprint: 'abc123',
      count: 1,
      suppressedSince: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      peakRate: 0,
    },
    environmentBadge: '[PROD]',
    ...overrides,
  }
}

const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/xxx'

describe('SlackAdapter', () => {
  let adapter: SlackAdapter
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = new SlackAdapter({ webhookUrl: WEBHOOK_URL })
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('send() posts to default webhook URL', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await adapter.send(makeAlert())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe(WEBHOOK_URL)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(options.body)
    expect(body.attachments).toBeDefined()
    expect(body.attachments).toHaveLength(1)
  })

  it('send() routes to level-specific channel', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const criticalUrl = 'https://hooks.slack.com/services/T000/B000/critical'
    adapter = new SlackAdapter({
      webhookUrl: WEBHOOK_URL,
      channels: { critical: criticalUrl },
    })
    await adapter.send(makeAlert({ level: 'critical' }))

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(criticalUrl)
  })

  it('send() routes to tag-specific channel with priority over level', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const paymentsUrl = 'https://hooks.slack.com/services/T000/B000/payments'
    adapter = new SlackAdapter({
      webhookUrl: WEBHOOK_URL,
      channels: { critical: 'https://hooks.slack.com/services/T000/B000/critical' },
      tags: { payments: paymentsUrl },
    })
    await adapter.send(makeAlert({ options: { tags: ['payments'] } }))

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(paymentsUrl)
  })

  it('send() includes mentions as text field', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    adapter = new SlackAdapter({
      webhookUrl: WEBHOOK_URL,
      mentions: { critical: ['<@U0123>', '<!subteam^S456>'] },
    })
    await adapter.send(makeAlert({ level: 'critical' }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text).toBe('<@U0123> <!subteam^S456>')
  })

  it('send() omits text when no mentions for level', async () => {
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    adapter = new SlackAdapter({
      webhookUrl: WEBHOOK_URL,
      mentions: { critical: ['<@U0123>'] },
    })
    await adapter.send(makeAlert({ level: 'info' }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text).toBeUndefined()
  })

  it('send() retries on 429 with Retry-After header', async () => {
    vi.useFakeTimers()

    const rateLimitResponse = new Response('rate_limited', {
      status: 429,
      headers: { 'Retry-After': '1' },
    })
    const okResponse = new Response('ok', { status: 200 })

    mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(okResponse)

    const sendPromise = adapter.send(makeAlert())
    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('send() throws on non-429 error responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response('invalid_payload', { status: 400 }))
    await expect(adapter.send(makeAlert())).rejects.toThrow('Slack webhook returned 400')
  })

  it('rateLimits() returns 1/1s', () => {
    expect(adapter.rateLimits()).toEqual({ maxPerWindow: 1, windowMs: 1_000 })
  })

  it('healthy() returns true', async () => {
    expect(await adapter.healthy()).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/adapters/slack/slack-adapter.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement Slack adapter**

Create `src/adapters/slack/slack-adapter.ts`:

```ts
import type { AlertAdapter, AlertLevel, FormattedAlert } from '../../core/types.js'
import { formatSlackPayload } from './formatter.js'

export interface SlackAdapterOptions {
  webhookUrl: string
  channels?: Partial<Record<AlertLevel, string>>
  tags?: Record<string, string>
  mentions?: Partial<Record<AlertLevel, string[]>>
}

export class SlackAdapter implements AlertAdapter {
  readonly name = 'slack' as const
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  private readonly webhookUrl: string
  private readonly channels: Partial<Record<AlertLevel, string>>
  private readonly tags: Record<string, string>
  private readonly mentions: Partial<Record<AlertLevel, string[]>>

  constructor(options: SlackAdapterOptions) {
    this.webhookUrl = options.webhookUrl
    this.channels = options.channels ?? {}
    this.tags = options.tags ?? {}
    this.mentions = options.mentions ?? {}
  }

  rateLimits() {
    return { maxPerWindow: 1, windowMs: 1_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    const payload = formatSlackPayload(alert)
    const { url, mentions } = this.resolve(alert.level, alert.options.tags)

    const body: Record<string, unknown> = { ...payload }

    if (mentions.length > 0) {
      body.text = mentions.join(' ')
    }

    await this.postWebhook(url, body)
  }

  async healthy(): Promise<boolean> {
    return true
  }

  private resolve(
    level: AlertLevel,
    tags?: string[],
  ): { url: string; mentions: string[] } {
    const mentions = this.mentions[level] ?? []

    if (tags?.length) {
      for (const tag of tags) {
        const url = this.tags[tag]
        if (url) return { url, mentions }
      }
    }

    const levelUrl = this.channels[level]
    if (levelUrl) return { url: levelUrl, mentions }

    return { url: this.webhookUrl, mentions }
  }

  private async postWebhook(
    url: string,
    body: Record<string, unknown>,
    retryCount = 0,
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (response.status === 429 && retryCount < 2) {
      const retryAfter = Number(response.headers.get('Retry-After')) || 1
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      return this.postWebhook(url, body, retryCount + 1)
    }

    if (!response.ok) {
      throw new Error(
        `Slack webhook returned ${response.status}: ${await response.text()}`,
      )
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/adapters/slack/
```

Expected: All Slack tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/slack/
git commit -m "feat: add SlackAdapter with routing and Block Kit formatting"
```

---

### Task 5: Telegram formatter

**Files:**
- Create: `src/adapters/telegram/formatter.ts`
- Create: `src/adapters/telegram/formatter.test.ts`

- [ ] **Step 1: Write failing tests for Telegram formatter**

Create `src/adapters/telegram/formatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { FormattedAlert } from '../../core/types.js'
import { formatTelegramMessage } from './formatter.js'

function makeAlert(overrides: Partial<FormattedAlert> = {}): FormattedAlert {
  return {
    level: 'critical',
    title: 'Test Error',
    message: 'Something failed',
    options: {},
    timestamp: Date.now(),
    serviceName: 'test-service',
    environment: 'production',
    aggregation: {
      phase: 'onset',
      fingerprint: 'abc123',
      count: 1,
      suppressedSince: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      peakRate: 0,
    },
    environmentBadge: '[PROD]',
    ...overrides,
  }
}

describe('formatTelegramMessage', () => {
  describe('onset phase', () => {
    it('includes emoji, badge, level, and title in bold', () => {
      const alert = makeAlert()
      const text = formatTelegramMessage(alert)
      expect(text).toContain('\ud83d\udd34')
      expect(text).toContain('[PROD]')
      expect(text).toContain('[CRITICAL]')
      expect(text).toContain('<b>')
      expect(text).toContain('Test Error')
    })

    it('includes the message body', () => {
      const alert = makeAlert({ message: 'Database connection lost' })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('Database connection lost')
    })

    it('includes stack trace in code block', () => {
      const error = new Error('boom')
      error.stack = 'Error: boom\n  at foo.ts:1'
      const alert = makeAlert({ error })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('<code>')
      expect(text).toContain('Error: boom')
    })

    it('maps fields as bold key-value pairs', () => {
      const alert = makeAlert({
        options: { fields: { userId: '42', region: 'us-east-1' } },
      })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('<b>userId:</b> 42')
      expect(text).toContain('<b>region:</b> us-east-1')
    })

    it('includes service name in italic footer', () => {
      const alert = makeAlert()
      const text = formatTelegramMessage(alert)
      expect(text).toContain('<i>Service: test-service')
    })
  })

  describe('ramp phase', () => {
    it('includes count and suppressed count', () => {
      const alert = makeAlert({
        aggregation: {
          phase: 'ramp',
          fingerprint: 'abc123',
          count: 10,
          suppressedSince: 5,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          peakRate: 0,
        },
      })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('x10')
      expect(text).toContain('5 suppressed')
    })
  })

  describe('sustained phase', () => {
    it('includes count and peak rate', () => {
      const alert = makeAlert({
        aggregation: {
          phase: 'sustained',
          fingerprint: 'abc123',
          count: 200,
          suppressedSince: 0,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          peakRate: 3.7,
        },
      })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('x200')
      expect(text).toContain('3.7/s')
    })
  })

  describe('resolution phase', () => {
    it('starts with checkmark and includes total count', () => {
      const now = Date.now()
      const alert = makeAlert({
        aggregation: {
          phase: 'resolution',
          fingerprint: 'abc123',
          count: 50,
          suppressedSince: 0,
          firstSeen: now - 3_600_000,
          lastSeen: now,
          peakRate: 0,
        },
      })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('\u2705')
      expect(text).toContain('50 total')
    })
  })

  describe('severity emojis', () => {
    it('uses blue circle for info', () => {
      const alert = makeAlert({ level: 'info' })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('\ud83d\udfe2') // We'll use specific emojis
    })

    it('uses warning triangle for warning', () => {
      const alert = makeAlert({ level: 'warning' })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('\u26a0\ufe0f')
    })

    it('uses red circle for critical', () => {
      const alert = makeAlert({ level: 'critical' })
      const text = formatTelegramMessage(alert)
      expect(text).toContain('\ud83d\udd34')
    })
  })

  describe('HTML escaping', () => {
    it('escapes HTML entities in title and message', () => {
      const alert = makeAlert({
        title: 'Error <script>alert("xss")</script>',
        message: 'Value is 5 > 3 & true',
      })
      const text = formatTelegramMessage(alert)
      expect(text).not.toContain('<script>')
      expect(text).toContain('&lt;script&gt;')
      expect(text).toContain('&amp;')
    })
  })

  describe('truncation', () => {
    it('truncates to 4096 characters', () => {
      const alert = makeAlert({ message: 'B'.repeat(5000) })
      const text = formatTelegramMessage(alert)
      expect(text.length).toBeLessThanOrEqual(4096)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/adapters/telegram/formatter.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Telegram formatter**

Create `src/adapters/telegram/formatter.ts`:

```ts
import type { FormattedAlert } from '../../core/types.js'
import { formatDuration } from '../../core/utils.js'

const SEVERITY_EMOJI: Record<string, string> = {
  info: '\ud83d\udfe2',
  warning: '\u26a0\ufe0f',
  critical: '\ud83d\udd34',
}

const RESOLUTION_EMOJI = '\u2705'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

export function formatTelegramMessage(alert: FormattedAlert): string {
  const { aggregation } = alert
  const phase = aggregation.phase
  const emoji =
    phase === 'resolution'
      ? RESOLUTION_EMOJI
      : (SEVERITY_EMOJI[alert.level] ?? SEVERITY_EMOJI.info)

  const lines: string[] = []

  switch (phase) {
    case 'onset': {
      lines.push(
        `${emoji} <b>${escapeHtml(alert.environmentBadge)} [${alert.level.toUpperCase()}] ${escapeHtml(alert.title)}</b>`,
      )
      lines.push('')
      lines.push(escapeHtml(alert.message))

      if (alert.error?.stack) {
        lines.push('')
        lines.push(`<code>${escapeHtml(alert.error.stack)}</code>`)
      }

      if (alert.options.fields) {
        lines.push('')
        for (const [key, value] of Object.entries(alert.options.fields)) {
          lines.push(`<b>${escapeHtml(key)}:</b> ${escapeHtml(String(value))}`)
        }
      }
      break
    }

    case 'ramp': {
      lines.push(
        `${emoji} <b>${escapeHtml(alert.environmentBadge)} [${alert.level.toUpperCase()}] ${escapeHtml(alert.title)} (x${aggregation.count} \u2014 ${aggregation.suppressedSince} suppressed since last)</b>`,
      )
      lines.push('')
      lines.push(escapeHtml(alert.message))
      break
    }

    case 'sustained': {
      lines.push(
        `${emoji} <b>${escapeHtml(alert.environmentBadge)} [${alert.level.toUpperCase()}] ${escapeHtml(alert.title)} (x${aggregation.count} \u00B7 peak: ${aggregation.peakRate.toFixed(1)}/s)</b>`,
      )
      lines.push('')
      lines.push(escapeHtml(alert.message))
      break
    }

    case 'resolution': {
      const totalDuration = formatDuration(
        aggregation.lastSeen - aggregation.firstSeen,
      )
      lines.push(
        `${RESOLUTION_EMOJI} <b>Resolved: ${escapeHtml(alert.title)} \u2014 ${aggregation.count} total over ${totalDuration}</b>`,
      )
      break
    }
  }

  lines.push('')
  lines.push(
    `<i>Service: ${escapeHtml(alert.serviceName)} | ${new Date(alert.timestamp).toISOString()}</i>`,
  )

  return truncate(lines.join('\n'), 4096)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/adapters/telegram/formatter.test.ts
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/telegram/
git commit -m "feat: add Telegram message formatter with HTML formatting"
```

---

### Task 6: Telegram adapter

**Files:**
- Create: `src/adapters/telegram/telegram-adapter.ts`
- Create: `src/adapters/telegram/telegram-adapter.test.ts`

- [ ] **Step 1: Write failing tests for Telegram adapter**

Create `src/adapters/telegram/telegram-adapter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormattedAlert } from '../../core/types.js'
import { TelegramAdapter } from './telegram-adapter.js'

function makeAlert(overrides: Partial<FormattedAlert> = {}): FormattedAlert {
  return {
    level: 'critical',
    title: 'Test Alert',
    message: 'Something went wrong',
    options: {},
    timestamp: Date.now(),
    serviceName: 'test-service',
    environment: 'production',
    aggregation: {
      phase: 'onset',
      fingerprint: 'abc123',
      count: 1,
      suppressedSince: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      peakRate: 0,
    },
    environmentBadge: '[PROD]',
    ...overrides,
  }
}

const BOT_TOKEN = '123456:ABC-DEF'
const CHAT_ID = '-1001234567890'

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = new TelegramAdapter({ botToken: BOT_TOKEN, chatId: CHAT_ID })
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('send() posts to Telegram Bot API with correct payload', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    await adapter.send(makeAlert())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    )
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body)
    expect(body.chat_id).toBe(CHAT_ID)
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toBeDefined()
    expect(body.message_thread_id).toBeUndefined()
  })

  it('send() routes to level-specific topic', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      topics: { critical: 42 },
    })
    await adapter.send(makeAlert({ level: 'critical' }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.message_thread_id).toBe(42)
  })

  it('send() routes to tag-specific topic with priority over level', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      topics: { critical: 42 },
      tags: { payments: 99 },
    })
    await adapter.send(
      makeAlert({ level: 'critical', options: { tags: ['payments'] } }),
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.message_thread_id).toBe(99)
  })

  it('send() includes mentions in the message text', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      mentions: { critical: ['@oncall_dev', '@team_lead'] },
    })
    await adapter.send(makeAlert({ level: 'critical' }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text).toContain('@oncall_dev @team_lead')
  })

  it('send() retries on 429 with retry_after from response body', async () => {
    vi.useFakeTimers()

    const rateLimitResponse = new Response(
      JSON.stringify({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 1 } }),
      { status: 429 },
    )
    const okResponse = new Response(
      JSON.stringify({ ok: true }),
      { status: 200 },
    )

    mockFetch
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(okResponse)

    const sendPromise = adapter.send(makeAlert())
    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('send() throws on non-429 error responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }),
        { status: 400 },
      ),
    )

    await expect(adapter.send(makeAlert())).rejects.toThrow(
      'Telegram API returned 400',
    )
  })

  it('rateLimits() returns 20/60s', () => {
    expect(adapter.rateLimits()).toEqual({
      maxPerWindow: 20,
      windowMs: 60_000,
    })
  })

  it('healthy() returns true', async () => {
    expect(await adapter.healthy()).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test src/adapters/telegram/telegram-adapter.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Telegram adapter**

Create `src/adapters/telegram/telegram-adapter.ts`:

```ts
import type { AlertAdapter, AlertLevel, FormattedAlert } from '../../core/types.js'
import { formatTelegramMessage } from './formatter.js'

export interface TelegramAdapterOptions {
  botToken: string
  chatId: string
  topics?: Partial<Record<AlertLevel, number>>
  tags?: Record<string, number>
  mentions?: Partial<Record<AlertLevel, string[]>>
}

export class TelegramAdapter implements AlertAdapter {
  readonly name = 'telegram' as const
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  private readonly botToken: string
  private readonly chatId: string
  private readonly topics: Partial<Record<AlertLevel, number>>
  private readonly tags: Record<string, number>
  private readonly mentions: Partial<Record<AlertLevel, string[]>>

  constructor(options: TelegramAdapterOptions) {
    this.botToken = options.botToken
    this.chatId = options.chatId
    this.topics = options.topics ?? {}
    this.tags = options.tags ?? {}
    this.mentions = options.mentions ?? {}
  }

  rateLimits() {
    return { maxPerWindow: 20, windowMs: 60_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    let text = formatTelegramMessage(alert)
    const { topicId, mentions } = this.resolve(alert.level, alert.options.tags)

    if (mentions.length > 0) {
      text = `${mentions.join(' ')}\n\n${text}`
    }

    const body: Record<string, unknown> = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
    }

    if (topicId !== undefined) {
      body.message_thread_id = topicId
    }

    await this.postApi(body)
  }

  async healthy(): Promise<boolean> {
    return true
  }

  private resolve(
    level: AlertLevel,
    tags?: string[],
  ): { topicId?: number; mentions: string[] } {
    const mentions = this.mentions[level] ?? []

    if (tags?.length) {
      for (const tag of tags) {
        const topicId = this.tags[tag]
        if (topicId !== undefined) return { topicId, mentions }
      }
    }

    const levelTopic = this.topics[level]
    if (levelTopic !== undefined) return { topicId: levelTopic, mentions }

    return { mentions }
  }

  private async postApi(
    body: Record<string, unknown>,
    retryCount = 0,
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (response.status === 429 && retryCount < 2) {
      const data = await response.json().catch(() => ({})) as Record<string, any>
      const retryAfter = data?.parameters?.retry_after ?? 1
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      return this.postApi(body, retryCount + 1)
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as Record<string, any>
      throw new Error(
        `Telegram API returned ${response.status}: ${data?.description ?? 'Unknown error'}`,
      )
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/adapters/telegram/
```

Expected: All Telegram tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/telegram/
git commit -m "feat: add TelegramAdapter with topic routing and HTML formatting"
```

---

### Task 7: Update exports and final verification

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update `src/index.ts`**

Add Slack and Telegram exports:

```ts
export type { SlackAdapterOptions } from './adapters/slack/slack-adapter.js'
export { SlackAdapter } from './adapters/slack/slack-adapter.js'
export type { TelegramAdapterOptions } from './adapters/telegram/telegram-adapter.js'
export { TelegramAdapter } from './adapters/telegram/telegram-adapter.js'
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 4: Run lint**

```bash
pnpm lint
```

Expected: No errors.

- [ ] **Step 5: Build**

```bash
pnpm build
```

Expected: Builds successfully.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: export SlackAdapter and TelegramAdapter from package entry"
```
