import { AlertLogger } from './alert-logger.js'
import type { AlertAdapter, AlertLevel, FormattedAlert } from './types.js'

class MockAdapter implements AlertAdapter {
  readonly name = 'mock'
  levels: AlertLevel[] = ['info', 'warning', 'critical']
  sent: FormattedAlert[] = []
  rateLimits() { return { maxPerWindow: 100, windowMs: 60_000 } }
  async send(alert: FormattedAlert) { this.sent.push(alert) }
}

afterEach(() => {
  AlertLogger.reset()
})

describe('AlertLogger integration', () => {
  describe('basic flow', () => {
    it('error() sends to adapter with correct level, title, message', async () => {
      const adapter = new MockAdapter()
      const logger = AlertLogger.init({
        adapters: [adapter],
        serviceName: 'test-service',
        environment: 'production',
      })

      logger.error('DB connection failed', new Error('ECONNREFUSED'))

      // Allow microtask (send is async)
      await vi.waitFor(() => expect(adapter.sent.length).toBe(1))

      const alert = adapter.sent[0]
      expect(alert.level).toBe('critical')
      expect(alert.title).toBe('DB connection failed')
      expect(alert.message).toBe('ECONNREFUSED')
    })
  })

  describe('aggregation', () => {
    it('suppresses non-power-of-2 duplicates after onset', async () => {
      const adapter = new MockAdapter()
      const logger = AlertLogger.init({
        adapters: [adapter],
        serviceName: 'test-service',
        environment: 'production',
      })

      const opts = { dedupKey: 'db-conn' }

      // count=1 (onset) -> sends
      logger.error('DB connection failed', new Error('ECONNREFUSED'), opts)
      // count=2 (power of 2) -> sends
      logger.error('DB connection failed', new Error('ECONNREFUSED'), opts)
      // count=3 (not power of 2) -> suppressed
      logger.error('DB connection failed', new Error('ECONNREFUSED'), opts)

      await new Promise((r) => setTimeout(r, 10))

      // count=3 should be suppressed; only count=1 and count=2 send
      expect(adapter.sent.length).toBe(2)

      // count=4 (power of 2) -> sends again
      logger.error('DB connection failed', new Error('ECONNREFUSED'), opts)
      await new Promise((r) => setTimeout(r, 10))
      expect(adapter.sent.length).toBe(3)
    })
  })

  describe('level filtering', () => {
    it('suppresses info when environment only allows critical', async () => {
      const adapter = new MockAdapter()
      const logger = AlertLogger.init({
        adapters: [adapter],
        serviceName: 'test-service',
        environment: 'production',
        environments: {
          production: { levels: ['critical'] },
        },
      })

      logger.info('Just a note')

      await new Promise((r) => setTimeout(r, 10))
      expect(adapter.sent.length).toBe(0)
    })
  })

  describe('environment badge', () => {
    it('attaches correct badge for production', async () => {
      const adapter = new MockAdapter()
      const logger = AlertLogger.init({
        adapters: [adapter],
        serviceName: 'test-service',
        environment: 'production',
      })

      logger.error('Something broke')

      await vi.waitFor(() => expect(adapter.sent.length).toBe(1))
      expect(adapter.sent[0].environmentBadge).toBe('[PROD]')
    })

    it('attaches correct badge for staging', async () => {
      const adapter = new MockAdapter()
      const logger = AlertLogger.init({
        adapters: [adapter],
        serviceName: 'test-service',
        environment: 'staging',
      })

      logger.error('Something broke')

      await vi.waitFor(() => expect(adapter.sent.length).toBe(1))
      expect(adapter.sent[0].environmentBadge).toBe('[STG]')
    })
  })

  describe('fields pass-through', () => {
    it('custom fields appear in the alert options', async () => {
      const adapter = new MockAdapter()
      const logger = AlertLogger.init({
        adapters: [adapter],
        serviceName: 'test-service',
        environment: 'production',
      })

      logger.error('Payment failed', new Error('timeout'), {
        fields: { orderId: 'abc-123', amount: 99.99 },
      })

      await vi.waitFor(() => expect(adapter.sent.length).toBe(1))
      expect(adapter.sent[0].options.fields).toEqual({
        orderId: 'abc-123',
        amount: 99.99,
      })
    })
  })

  describe('singleton', () => {
    it('init() sets instance and getInstance() retrieves it', () => {
      const adapter = new MockAdapter()
      const logger = AlertLogger.init({
        adapters: [adapter],
        serviceName: 'test-service',
        environment: 'production',
      })

      expect(AlertLogger.getInstance()).toBe(logger)
    })

    it('getInstance() throws before init()', () => {
      expect(() => AlertLogger.getInstance()).toThrow(
        'AlertLogger not initialized',
      )
    })
  })
})
