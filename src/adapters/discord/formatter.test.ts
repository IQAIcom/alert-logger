import type { FormattedAlert } from '../../core/types.js'
import { formatDiscordEmbed } from './formatter.js'

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
    pings: [],
    environmentBadge: '[PROD]',
    ...overrides,
  }
}

describe('formatDiscordEmbed', () => {
  describe('onset phase', () => {
    it('includes badge, level, and title in the embed title', () => {
      const alert = makeAlert()
      const embed = formatDiscordEmbed(alert)

      expect(embed.title).toContain('[PROD]')
      expect(embed.title).toContain('[CRITICAL]')
      expect(embed.title).toContain('Test Error')
    })

    it('has a description matching the alert message', () => {
      const alert = makeAlert({ message: 'Database connection lost' })
      const embed = formatDiscordEmbed(alert)

      expect(embed.description).toBe('Database connection lost')
    })

    it('has a footer with the service name', () => {
      const alert = makeAlert()
      const embed = formatDiscordEmbed(alert)

      expect(embed.footer).toEqual({ text: 'Service: test-service' })
    })

    it('includes stack trace in a code block in the description', () => {
      const error = new Error('boom')
      error.stack = 'Error: boom\n  at foo.ts:1\n  at bar.ts:2'
      const alert = makeAlert({ error })
      const embed = formatDiscordEmbed(alert)

      expect(embed.description).toContain('```')
      expect(embed.description).toContain('Error: boom')
      expect(embed.description).toContain('at foo.ts:1')
    })

    it('maps alert options.fields to embed fields', () => {
      const alert = makeAlert({
        options: {
          fields: { userId: '42', region: 'us-east-1' },
        },
      })
      const embed = formatDiscordEmbed(alert)

      expect(embed.fields).toBeDefined()
      expect(embed.fields).toHaveLength(2)
      expect(embed.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'userId', value: '42', inline: true }),
          expect.objectContaining({ name: 'region', value: 'us-east-1', inline: true }),
        ]),
      )
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
      const embed = formatDiscordEmbed(alert)

      expect(embed.title).toContain('x10')
      expect(embed.title).toContain('5 suppressed since last')
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
      const embed = formatDiscordEmbed(alert)

      expect(embed.title).toContain('x200')
      expect(embed.title).toContain('peak rate: 3.7/s')
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
      const embed = formatDiscordEmbed(alert)

      expect(embed.title).toMatch(/^\u2705/)
      expect(embed.title).toContain('50 total')
      expect(embed.title).toContain('1h')
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
      const embed = formatDiscordEmbed(alert)

      expect(embed.color).toBe(0x2ecc71)
    })
  })

  describe('mention sanitization', () => {
    it('sanitizes @everyone and @here in the title', () => {
      const alert = makeAlert({ title: 'Alert @everyone and @here' })
      const embed = formatDiscordEmbed(alert)

      expect(embed.title).not.toContain('@everyone')
      expect(embed.title).not.toContain('@here')
    })

    it('sanitizes user mentions in the message', () => {
      const alert = makeAlert({ message: 'Triggered by <@123456>' })
      const embed = formatDiscordEmbed(alert)

      expect(embed.description).not.toContain('<@123456>')
      expect(embed.description).toContain('[mention]')
    })
  })

  describe('truncation', () => {
    it('truncates long titles to 256 characters', () => {
      const alert = makeAlert({ title: 'A'.repeat(300) })
      const embed = formatDiscordEmbed(alert)

      expect(embed.title.length).toBeLessThanOrEqual(256)
    })

    it('truncates long descriptions to 2000 characters', () => {
      const alert = makeAlert({ message: 'B'.repeat(2500) })
      const embed = formatDiscordEmbed(alert)

      expect(embed.description?.length).toBeLessThanOrEqual(2000)
    })
  })

  describe('severity colors', () => {
    it('uses blue for info', () => {
      const alert = makeAlert({ level: 'info' })
      const embed = formatDiscordEmbed(alert)

      expect(embed.color).toBe(0x3498db)
    })

    it('uses orange for warning', () => {
      const alert = makeAlert({ level: 'warning' })
      const embed = formatDiscordEmbed(alert)

      expect(embed.color).toBe(0xf39c12)
    })

    it('uses red for critical', () => {
      const alert = makeAlert({ level: 'critical' })
      const embed = formatDiscordEmbed(alert)

      expect(embed.color).toBe(0xe74c3c)
    })
  })
})
