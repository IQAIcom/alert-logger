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

const WEBHOOK_URL = 'https://hooks.slack.com/services/T00/B00/xxx'

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
		expect(body.attachments).toBeDefined()
		expect(body.attachments).toHaveLength(1)
		// No mentions configured, so text should be absent
		expect(body.text).toBeUndefined()
	})

	it('send() routes to level-specific channel', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

		const criticalUrl = 'https://hooks.slack.com/services/T00/B00/critical'
		adapter = new SlackAdapter({
			webhookUrl: WEBHOOK_URL,
			channels: { critical: criticalUrl },
		})
		await adapter.send(makeAlert({ level: 'critical' }))

		const [url] = mockFetch.mock.calls[0]
		expect(url).toBe(criticalUrl)
	})

	it('send() routes to tag-specific channel with priority over level', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

		const paymentsUrl = 'https://hooks.slack.com/services/T00/B00/payments'
		adapter = new SlackAdapter({
			webhookUrl: WEBHOOK_URL,
			channels: { critical: 'https://hooks.slack.com/services/T00/B00/critical' },
			tags: { payments: paymentsUrl },
		})
		await adapter.send(makeAlert({ level: 'critical', options: { tags: ['payments'] } }))

		const [url] = mockFetch.mock.calls[0]
		expect(url).toBe(paymentsUrl)
	})

	it('send() includes mentions as text field', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

		adapter = new SlackAdapter({
			webhookUrl: WEBHOOK_URL,
			mentions: { critical: ['<@U123>', '<@U456>'] },
		})
		await adapter.send(makeAlert({ level: 'critical' }))

		const body = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(body.text).toBe('<@U123> <@U456>')
	})

	it('send() omits text when no mentions for level', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

		adapter = new SlackAdapter({
			webhookUrl: WEBHOOK_URL,
			mentions: { critical: ['<@U123>'] },
		})
		await adapter.send(makeAlert({ level: 'info' }))

		const body = JSON.parse(mockFetch.mock.calls[0][1].body)
		expect(body.text).toBeUndefined()
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
		await expect(adapter.send(alert)).rejects.toThrow('Slack webhook returned 403')
	})

	it('rateLimits() returns 1/1s', () => {
		const limits = adapter.rateLimits()
		expect(limits).toEqual({ maxPerWindow: 1, windowMs: 1_000 })
	})

	it('healthy() returns true', async () => {
		const result = await adapter.healthy()
		expect(result).toBe(true)
	})
})
