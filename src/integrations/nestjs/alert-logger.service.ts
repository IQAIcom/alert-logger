import { Inject, Injectable } from '@nestjs/common'
import type { AlertLogger } from '../../core/alert-logger.js'
import type { AlertOptions } from '../../core/types.js'
import { requestStore } from './alert-context.middleware.js'
import { ALERT_LOGGER_INSTANCE } from './types.js'

@Injectable()
export class AlertLoggerService {
  constructor(@Inject(ALERT_LOGGER_INSTANCE) private readonly logger: AlertLogger) {}

  info(title: string, options?: AlertOptions): void {
    this.logger.info(title, this.mergeContext(options))
  }

  warn(title: string, options?: AlertOptions): void {
    this.logger.warn(title, this.mergeContext(options))
  }

  error(title: string, error?: Error | string | AlertOptions, options?: AlertOptions): void {
    // When called as error("title", { ... }), pass through directly
    if (error != null && typeof error === 'object' && !(error instanceof Error)) {
      this.logger.error(title, this.mergeContext(error))
    } else {
      this.logger.error(title, error, this.mergeContext(options))
    }
  }

  critical(title: string, error?: Error | string | AlertOptions, options?: AlertOptions): void {
    if (error != null && typeof error === 'object' && !(error instanceof Error)) {
      this.logger.critical(title, this.mergeContext(error))
    } else {
      this.logger.critical(title, error, this.mergeContext(options))
    }
  }

  private mergeContext(options?: AlertOptions): AlertOptions {
    const ctx = requestStore.getStore()
    if (!ctx) return options ?? {}

    return {
      ...options,
      fields: {
        requestId: ctx.requestId,
        method: ctx.method,
        path: ctx.path,
        ...options?.fields,
      },
    }
  }
}
