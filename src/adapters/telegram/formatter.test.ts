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
    it('includes severity emoji, badge, level, and title in bold', () => {
      const alert = makeAlert()
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('🔴')
      expect(msg).toContain('<b>[PROD] [CRITICAL] Test Error</b>')
    })

    it('includes message body', () => {
      const alert = makeAlert({ message: 'Database connection lost' })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('Database connection lost')
    })

    it('includes stack trace in code block', () => {
      const error = new Error('boom')
      error.stack = 'Error: boom\n  at foo.ts:1\n  at bar.ts:2'
      const alert = makeAlert({ error })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('<code>')
      expect(msg).toContain('Error: boom')
      expect(msg).toContain('at foo.ts:1')
    })

    it('includes fields as bold key-value pairs', () => {
      const alert = makeAlert({
        options: {
          fields: { userId: '42', region: 'us-east-1' },
        },
      })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('<b>userId:</b> 42')
      expect(msg).toContain('<b>region:</b> us-east-1')
    })

    it('includes italic footer with service name and timestamp', () => {
      const alert = makeAlert()
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('<i>Service: test-service |')
      expect(msg).toContain('</i>')
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
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('x10')
      expect(msg).toContain('5 suppressed since last')
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
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('x200')
      expect(msg).toContain('peak: 3.7/s')
    })
  })

  describe('resolution phase', () => {
    it('starts with checkmark emoji and includes total count and duration', () => {
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
      const msg = formatTelegramMessage(alert)

      expect(msg).toMatch(/^✅/)
      expect(msg).toContain('50 total')
      expect(msg).toContain('1h')
    })

    it('uses resolution emoji instead of severity emoji', () => {
      const alert = makeAlert({
        level: 'critical',
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
      const msg = formatTelegramMessage(alert)

      expect(msg).toMatch(/^✅/)
      expect(msg).not.toContain('🔴')
    })
  })

  describe('severity emojis', () => {
    it('uses blue circle for info', () => {
      const alert = makeAlert({ level: 'info' })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('\ud83d\udd35')
    })

    it('uses warning sign for warning', () => {
      const alert = makeAlert({ level: 'warning' })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('⚠️')
    })

    it('uses red circle for critical', () => {
      const alert = makeAlert({ level: 'critical' })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('🔴')
    })
  })

  describe('HTML escaping', () => {
    it('escapes HTML special characters in title', () => {
      const alert = makeAlert({ title: '<script>alert("xss")</script>' })
      const msg = formatTelegramMessage(alert)

      expect(msg).not.toContain('<script>')
      expect(msg).toContain('&lt;script&gt;')
    })

    it('escapes HTML special characters in message', () => {
      const alert = makeAlert({ message: 'x > 5 && y < 10' })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('x &gt; 5 &amp;&amp; y &lt; 10')
    })

    it('escapes HTML special characters in field keys and values', () => {
      const alert = makeAlert({
        options: {
          fields: { '<key>': '<value>' },
        },
      })
      const msg = formatTelegramMessage(alert)

      expect(msg).toContain('<b>&lt;key&gt;:</b> &lt;value&gt;')
    })
  })

  describe('truncation', () => {
    it('truncates messages exceeding 4096 characters', () => {
      const alert = makeAlert({ message: 'A'.repeat(5000) })
      const msg = formatTelegramMessage(alert)

      expect(msg.length).toBeLessThanOrEqual(4096)
    })
  })
})
