export { createAlertLoggerHandler, captureRequestError } from './handler.js'
export type { AlertLoggerConfig } from '../../core/types.js'

import { AlertLogger } from '../../core/alert-logger.js'

/**
 * Get the AlertLogger instance for manual logging in server components/actions.
 * Throws if createAlertLoggerHandler() hasn't been called yet.
 */
export function getAlertLogger(): AlertLogger {
  return AlertLogger.getInstance()
}
