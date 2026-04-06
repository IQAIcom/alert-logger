import type { ArgumentsHost } from '@nestjs/common'
import { Catch, HttpException } from '@nestjs/common'
import { BaseExceptionFilter, type HttpAdapterHost } from '@nestjs/core'
import type { AlertLoggerService } from './alert-logger.service.js'

@Catch()
export class AlertExceptionFilter extends BaseExceptionFilter {
  constructor(
    private readonly alert: AlertLoggerService,
    httpAdapterHost: HttpAdapterHost,
  ) {
    super(httpAdapterHost.httpAdapter)
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const request = ctx.getRequest<{
      method?: string
      url?: string
      ip?: string
    }>()

    const method = request?.method ?? 'UNKNOWN'
    const path = request?.url ?? 'UNKNOWN'
    const ip = request?.ip ?? 'UNKNOWN'

    const title = `${method} ${path}`

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus()

      if (statusCode >= 500) {
        this.alert.error(title, exception, {
          fields: { method, path, statusCode, ip },
        })
      }
    } else {
      const error = exception instanceof Error ? exception : new Error(String(exception))

      this.alert.critical(title, error, {
        fields: { method, path, statusCode: 500, ip },
      })
    }

    // Delegate to BaseExceptionFilter for proper response handling
    super.catch(exception, host)
  }
}
