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
		it('includes badge, level, and title in the header', () => {
			const alert = makeAlert()
			const payload = formatSlackPayload(alert)

			const header = payload.attachments[0].blocks[0]
			expect(header.type).toBe('header')
			expect(header.text?.text).toContain('[PROD]')
			expect(header.text?.text).toContain('[CRITICAL]')
			expect(header.text?.text).toContain('Test Error')
		})

		it('has a section with the alert message', () => {
			const alert = makeAlert({ message: 'Database connection lost' })
			const payload = formatSlackPayload(alert)

			const section = payload.attachments[0].blocks[1]
			expect(section.type).toBe('section')
			expect(section.text?.type).toBe('mrkdwn')
			expect(section.text?.text).toBe('Database connection lost')
		})

		it('has a context block with service name and timestamp', () => {
			const alert = makeAlert()
			const payload = formatSlackPayload(alert)

			const blocks = payload.attachments[0].blocks
			const context = blocks[blocks.length - 1]
			expect(context.type).toBe('context')
			expect(context.elements?.[0].text).toContain('Service: test-service')
		})

		it('includes stack trace in a code block in the body', () => {
			const error = new Error('boom')
			error.stack = 'Error: boom\n  at foo.ts:1\n  at bar.ts:2'
			const alert = makeAlert({ error })
			const payload = formatSlackPayload(alert)

			const section = payload.attachments[0].blocks[1]
			expect(section.text?.text).toContain('```')
			expect(section.text?.text).toContain('Error: boom')
			expect(section.text?.text).toContain('at foo.ts:1')
		})

		it('maps alert options.fields to section fields', () => {
			const alert = makeAlert({
				options: {
					fields: { userId: '42', region: 'us-east-1' },
				},
			})
			const payload = formatSlackPayload(alert)

			const blocks = payload.attachments[0].blocks
			const fieldsBlock = blocks.find((b) => b.fields !== undefined)
			expect(fieldsBlock).toBeDefined()
			expect(fieldsBlock?.fields).toHaveLength(2)
			expect(fieldsBlock?.fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'mrkdwn', text: '*userId:* 42' }),
					expect.objectContaining({ type: 'mrkdwn', text: '*region:* us-east-1' }),
				]),
			)
		})
	})

	describe('context block in all phases', () => {
		it('includes context block in ramp phase', () => {
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
			const blocks = payload.attachments[0].blocks
			const context = blocks[blocks.length - 1]
			expect(context.type).toBe('context')
			expect(context.elements?.[0].text).toContain('Service: test-service')
		})

		it('includes context block in resolution phase', () => {
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
			const blocks = payload.attachments[0].blocks
			const context = blocks[blocks.length - 1]
			expect(context.type).toBe('context')
			expect(context.elements?.[0].text).toContain('Service: test-service')
		})
	})

	describe('ramp phase', () => {
		it('includes count and suppressed count in the title', () => {
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

			const header = payload.attachments[0].blocks[0]
			expect(header.text?.text).toContain('x10')
			expect(header.text?.text).toContain('5 suppressed since last')
		})
	})

	describe('sustained phase', () => {
		it('includes count and peak rate in the title', () => {
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

			const header = payload.attachments[0].blocks[0]
			expect(header.text?.text).toContain('x200')
			expect(header.text?.text).toContain('peak: 3.7/s')
		})
	})

	describe('resolution phase', () => {
		it('starts with a checkmark and includes total count and duration', () => {
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

			const header = payload.attachments[0].blocks[0]
			expect(header.text?.text).toMatch(/^\u2705/)
			expect(header.text?.text).toContain('50 total')
			expect(header.text?.text).toContain('1h')
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

	describe('truncation', () => {
		it('truncates long titles to 150 characters', () => {
			const alert = makeAlert({ title: 'A'.repeat(200) })
			const payload = formatSlackPayload(alert)

			const header = payload.attachments[0].blocks[0]
			expect(header.text?.text.length).toBeLessThanOrEqual(150)
		})

		it('truncates long body to 3000 characters', () => {
			const alert = makeAlert({ message: 'B'.repeat(3500) })
			const payload = formatSlackPayload(alert)

			const section = payload.attachments[0].blocks[1]
			expect(section.text?.text.length).toBeLessThanOrEqual(3000)
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
})
