import { describe, it, expect, afterEach, vi } from 'vitest'
import { AlertLogger } from '../../core/alert-logger.js'
import { createAlertLoggerHandler, captureRequestError } from './handler.js'
import { getAlertLogger } from './index.js'
import type { AlertAdapter } from '../../core/types.js'

const mockAdapter: AlertAdapter = {
  name: 'mock',
  levels: ['info', 'warning', 'critical'] as const,
  send: vi.fn().mockResolvedValue(undefined),
  rateLimits: () => ({ maxPerWindow: 100, windowMs: 60_000 }),
}

afterEach(() => {
  AlertLogger.reset()
  vi.restoreAllMocks()
})

describe('createAlertLoggerHandler', () => {
  it('initializes AlertLogger singleton', () => {
    createAlertLoggerHandler({ adapters: [mockAdapter] })

    const instance = AlertLogger.getInstance()
    expect(instance).toBeInstanceOf(AlertLogger)
  })
})

describe('captureRequestError', () => {
  it('calls logger.error with correct fields', () => {
    createAlertLoggerHandler({ adapters: [mockAdapter] })
    const logger = AlertLogger.getInstance()
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {})

    const error = new Error('test failure')
    const request = {
      path: '/api/users',
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    }
    const context = {
      routerKind: 'App' as const,
      routeType: 'route' as const,
      renderSource: 'react-server-components',
    }

    captureRequestError(error, request, context)

    expect(errorSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith(
      '[Next.js] App/route error',
      error,
      {
        fields: {
          path: '/api/users',
          method: 'GET',
          routerKind: 'App',
          routeType: 'route',
          renderSource: 'react-server-components',
        },
        tags: ['nextjs'],
      },
    )
  })

  it('handles missing logger gracefully (no throw)', () => {
    // AlertLogger not initialized — captureRequestError should not throw
    expect(() =>
      captureRequestError(
        new Error('boom'),
        { path: '/', method: 'GET', headers: {} },
        { routerKind: 'Pages', routeType: 'page' },
      ),
    ).not.toThrow()
  })
})

describe('getAlertLogger', () => {
  it('returns the AlertLogger instance', () => {
    createAlertLoggerHandler({ adapters: [mockAdapter] })

    const instance = getAlertLogger()
    expect(instance).toBeInstanceOf(AlertLogger)
    expect(instance).toBe(AlertLogger.getInstance())
  })

  it('throws when not initialized', () => {
    expect(() => getAlertLogger()).toThrow(
      'AlertLogger not initialized. Call AlertLogger.init() first.',
    )
  })
})
