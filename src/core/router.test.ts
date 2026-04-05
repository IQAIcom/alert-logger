import { Router } from './router.js'
import type { AlertLevel, RoutingConfig } from './types.js'

describe('Router', () => {
  describe('tag routing', () => {
    it('returns webhook URL when tag matches', () => {
      const routing: RoutingConfig = {
        tags: { payments: 'https://hooks.example.com/payments' },
      }
      const router = new Router(routing, {})

      const result = router.route('critical', ['payments'])

      expect(result.webhookUrl).toBe('https://hooks.example.com/payments')
    })
  })

  describe('level routing', () => {
    it('returns webhook URL for level when no tag match', () => {
      const routing: RoutingConfig = {
        channels: { critical: 'https://hooks.example.com/critical' },
      }
      const router = new Router(routing, {})

      const result = router.route('critical')

      expect(result.webhookUrl).toBe('https://hooks.example.com/critical')
    })
  })

  describe('default routing', () => {
    it('returns no webhookUrl when nothing matches', () => {
      const routing: RoutingConfig = {}
      const router = new Router(routing, {})

      const result = router.route('info')

      expect(result.webhookUrl).toBeUndefined()
    })
  })

  describe('cascade priority', () => {
    it('tag match takes priority over level match', () => {
      const routing: RoutingConfig = {
        channels: { critical: 'https://hooks.example.com/critical' },
        tags: { payments: 'https://hooks.example.com/payments' },
      }
      const router = new Router(routing, {})

      const result = router.route('critical', ['payments'])

      expect(result.webhookUrl).toBe('https://hooks.example.com/payments')
    })
  })

  describe('pings', () => {
    it('returns correct pings for level', () => {
      const routing: RoutingConfig = {}
      const pings: Partial<Record<AlertLevel, string[]>> = {
        critical: ['<@oncall>', '<@eng-lead>'],
      }
      const router = new Router(routing, pings)

      const result = router.route('critical')

      expect(result.pings).toEqual(['<@oncall>', '<@eng-lead>'])
    })
  })

  describe('empty pings', () => {
    it('returns empty array when no pings configured for level', () => {
      const routing: RoutingConfig = {}
      const router = new Router(routing, {})

      const result = router.route('warning')

      expect(result.pings).toEqual([])
    })
  })
})
