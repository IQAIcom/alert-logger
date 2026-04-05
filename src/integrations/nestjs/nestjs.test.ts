import { AlertContextMiddleware, requestStore } from './alert-context.middleware.js'
import { AlertLoggerService } from './alert-logger.service.js'

// ---------------------------------------------------------------------------
// AlertLoggerService
// ---------------------------------------------------------------------------
describe('AlertLoggerService', () => {
  let mockLogger: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    critical: ReturnType<typeof vi.fn>
  }
  let service: AlertLoggerService

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      critical: vi.fn(),
    }
    service = new AlertLoggerService(mockLogger as any)
  })

  it('info() forwards to AlertLogger.info', () => {
    service.info('hello', { fields: { foo: 'bar' } })

    expect(mockLogger.info).toHaveBeenCalledOnce()
    expect(mockLogger.info).toHaveBeenCalledWith('hello', { fields: { foo: 'bar' } })
  })

  it('warn() forwards to AlertLogger.warn', () => {
    service.warn('watch out', { tags: ['ops'] })

    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith('watch out', { tags: ['ops'] })
  })

  it('error() forwards to AlertLogger.error with error object', () => {
    const err = new Error('boom')
    service.error('failure', err, { fields: { code: 500 } })

    expect(mockLogger.error).toHaveBeenCalledOnce()
    expect(mockLogger.error).toHaveBeenCalledWith('failure', err, { fields: { code: 500 } })
  })

  it('critical() forwards to AlertLogger.critical', () => {
    const err = new Error('fatal')
    service.critical('meltdown', err)

    expect(mockLogger.critical).toHaveBeenCalledOnce()
    expect(mockLogger.critical).toHaveBeenCalledWith('meltdown', err, {})
  })

  it('merges request context into fields when AsyncLocalStorage has context', () => {
    const ctx = { requestId: 'req-123', method: 'POST', path: '/api/test' }

    requestStore.run(ctx, () => {
      service.info('with context')

      expect(mockLogger.info).toHaveBeenCalledOnce()
      const passedOptions = mockLogger.info.mock.calls[0][1]
      expect(passedOptions).toEqual({
        fields: {
          requestId: 'req-123',
          method: 'POST',
          path: '/api/test',
        },
      })
    })
  })

  it('works without request context (no AsyncLocalStorage store)', () => {
    // Outside of requestStore.run — getStore() returns undefined
    service.warn('no context')

    expect(mockLogger.warn).toHaveBeenCalledOnce()
    expect(mockLogger.warn).toHaveBeenCalledWith('no context', {})
  })

  it('user-provided fields take precedence over context fields', () => {
    const ctx = { requestId: 'req-999', method: 'GET', path: '/old' }

    requestStore.run(ctx, () => {
      service.info('override test', {
        fields: { requestId: 'custom-id', extra: 'value' },
      })

      const passedOptions = mockLogger.info.mock.calls[0][1]
      expect(passedOptions).toEqual({
        fields: {
          requestId: 'custom-id',
          method: 'GET',
          path: '/old',
          extra: 'value',
        },
      })
    })
  })
})

// ---------------------------------------------------------------------------
// AlertContextMiddleware
// ---------------------------------------------------------------------------
describe('AlertContextMiddleware', () => {
  let middleware: AlertContextMiddleware

  beforeEach(() => {
    middleware = new AlertContextMiddleware()
  })

  it('sets requestId from x-request-id header', () => {
    const req = {
      headers: { 'x-request-id': 'header-id-42' },
      method: 'GET',
      originalUrl: '/health',
    }

    middleware.use(req as any, {} as any, () => {
      const ctx = requestStore.getStore()
      expect(ctx).toBeDefined()
      expect(ctx?.requestId).toBe('header-id-42')
    })
  })

  it('auto-generates UUID when no x-request-id header is present', () => {
    const req = {
      headers: {},
      method: 'POST',
      originalUrl: '/api/data',
    }

    middleware.use(req as any, {} as any, () => {
      const ctx = requestStore.getStore()
      expect(ctx).toBeDefined()
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(ctx?.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    })
  })

  it('sets method and path from request', () => {
    const req = {
      headers: {},
      method: 'DELETE',
      originalUrl: '/api/items/5',
    }

    middleware.use(req as any, {} as any, () => {
      const ctx = requestStore.getStore()
      expect(ctx).toBeDefined()
      expect(ctx?.method).toBe('DELETE')
      expect(ctx?.path).toBe('/api/items/5')
    })
  })
})
