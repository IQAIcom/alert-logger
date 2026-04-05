import { AlertLogger } from '../../core/alert-logger.js'
import type { AlertLoggerConfig } from '../../core/types.js'

/**
 * Initialize AlertLogger in Next.js instrumentation.ts register().
 * Call this once in your register() function.
 */
export function createAlertLoggerHandler(config: AlertLoggerConfig): void {
  AlertLogger.init(config)
}

/**
 * Next.js 15+ onRequestError handler.
 * Export this as `onRequestError` from instrumentation.ts.
 */
export function captureRequestError(
  error: unknown,
  request: {
    path: string
    method: string
    headers: Record<string, string | string[] | undefined>
  },
  context: {
    routerKind: 'Pages' | 'App'
    routeType: 'route' | 'page' | 'middleware'
    renderSource?: string
  },
): void {
  let logger: AlertLogger
  try {
    logger = AlertLogger.getInstance()
  } catch {
    // AlertLogger not initialized — silently skip
    return
  }

  const err = error instanceof Error ? error : new Error(String(error))
  const routeLabel = `${context.routerKind}/${context.routeType}`

  logger.error(`[Next.js] ${routeLabel} error`, err, {
    fields: {
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routeType: context.routeType,
      renderSource: context.renderSource ?? 'unknown',
    },
    tags: ['nextjs'],
  })
}
