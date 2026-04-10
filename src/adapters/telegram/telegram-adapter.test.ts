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
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const alert = makeAlert()
    await adapter.send(alert)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(options.body)
    expect(body.chat_id).toBe(CHAT_ID)
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toBeDefined()
    expect(body.message_thread_id).toBeUndefined()
  })

  it('send() routes to level-specific topic', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

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
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      topics: { critical: 42 },
      tags: { payments: 99 },
    })
    await adapter.send(makeAlert({ level: 'critical', options: { tags: ['payments'] } }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.message_thread_id).toBe(99)
  })

  it('send() prepends mentions to text', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      mentions: { critical: ['@admin', '@oncall'] },
    })
    await adapter.send(makeAlert({ level: 'critical' }))

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text).toMatch(/^@admin @oncall\n/)
  })

  it('send() retries on 429 with body-based retry_after', async () => {
    vi.useFakeTimers()

    const rateLimitBody = JSON.stringify({
      ok: false,
      description: 'Too Many Requests',
      parameters: { retry_after: 2 },
    })
    const rateLimitResponse = new Response(rateLimitBody, { status: 429 })
    const okResponse = new Response(JSON.stringify({ ok: true }), { status: 200 })

    mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(okResponse)

    const alert = makeAlert()
    const sendPromise = adapter.send(alert)
    await vi.runAllTimersAsync()
    await sendPromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('send() throws on non-429 error responses', async () => {
    const errorBody = JSON.stringify({
      ok: false,
      description: 'Bad Request: chat not found',
    })
    mockFetch.mockResolvedValueOnce(new Response(errorBody, { status: 400 }))

    const alert = makeAlert()
    await expect(adapter.send(alert)).rejects.toThrow(
      'Telegram API error: Bad Request: chat not found',
    )
  })

  it('rateLimits() returns 20/60s', () => {
    const limits = adapter.rateLimits()
    expect(limits).toEqual({ maxPerWindow: 20, windowMs: 60_000 })
  })

  it('healthy() returns true', async () => {
    const result = await adapter.healthy()
    expect(result).toBe(true)
  })
})
