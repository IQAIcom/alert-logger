import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormattedAlert } from '../../core/types.js'
import { DiscordAdapter } from './discord-adapter.js'

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

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/abc'

describe('DiscordAdapter', () => {
  let adapter: DiscordAdapter
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = new DiscordAdapter({ webhookUrl: WEBHOOK_URL })
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('send() posts to webhook URL with correct payload', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const alert = makeAlert()
    await adapter.send(alert)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe(WEBHOOK_URL)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(options.body)
    expect(body.embeds).toBeDefined()
    expect(body.embeds).toHaveLength(1)
    // No mentions configured, so content should be absent
    expect(body.content).toBeUndefined()
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
    adapter = new DiscordAdapter({
      webhookUrl: WEBHOOK_URL,
      channels: { critical: 'https://discord.com/api/webhooks/999/critical' },
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

  it('send() retries on 429 with Retry-After header', async () => {
    vi.useFakeTimers()

    const rateLimitResponse = new Response(null, {
      status: 429,
      headers: { 'Retry-After': '1' },
    })
    const okResponse = new Response(null, { status: 200 })

    mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(okResponse)

    const alert = makeAlert()
    const sendPromise = adapter.send(alert)
    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('send() throws on non-429 error responses', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const alert = makeAlert()
    await expect(adapter.send(alert)).rejects.toThrow('Discord webhook returned 403')
  })

  it('rateLimits() returns 30/60s', () => {
    const limits = adapter.rateLimits()
    expect(limits).toEqual({ maxPerWindow: 30, windowMs: 60_000 })
  })

  it('healthy() returns true', async () => {
    const result = await adapter.healthy()
    expect(result).toBe(true)
  })
})
