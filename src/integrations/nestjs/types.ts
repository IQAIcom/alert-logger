import type { AlertLoggerConfig } from '../../core/types.js'

export const ALERT_LOGGER_OPTIONS = Symbol('ALERT_LOGGER_OPTIONS')
export const ALERT_LOGGER_INSTANCE = Symbol('ALERT_LOGGER_INSTANCE')

export interface AlertLoggerModuleOptions extends AlertLoggerConfig {
  exceptions?: { autoRegister?: boolean }
}

export interface AlertLoggerAsyncOptions {
  exceptions?: { autoRegister?: boolean }
  useFactory: (...args: any[]) => AlertLoggerModuleOptions | Promise<AlertLoggerModuleOptions>
  inject?: any[]
  imports?: any[]
}
