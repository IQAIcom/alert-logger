import {
  Global,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  type Provider,
} from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { AlertLogger } from '../../core/alert-logger.js'
import {
  ALERT_LOGGER_OPTIONS,
  ALERT_LOGGER_INSTANCE,
  type AlertLoggerModuleOptions,
  type AlertLoggerAsyncOptions,
} from './types.js'
import { AlertContextMiddleware } from './alert-context.middleware.js'
import { AlertLoggerService } from './alert-logger.service.js'
import { AlertExceptionFilter } from './exception.filter.js'

@Global()
@Module({})
export class AlertLoggerModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AlertContextMiddleware).forRoutes('*')
  }

  static forRoot(options: AlertLoggerModuleOptions): DynamicModule {
    const autoRegister = options.exceptions?.autoRegister !== false

    const providers: Provider[] = [
      {
        provide: ALERT_LOGGER_OPTIONS,
        useValue: options,
      },
      {
        provide: ALERT_LOGGER_INSTANCE,
        useFactory: () => AlertLogger.init(options),
      },
      AlertLoggerService,
    ]

    if (autoRegister) {
      providers.push({
        provide: APP_FILTER,
        useClass: AlertExceptionFilter,
      })
    }

    return {
      module: AlertLoggerModule,
      providers,
      exports: [AlertLoggerService, ALERT_LOGGER_INSTANCE],
    }
  }

  static forRootAsync(options: AlertLoggerAsyncOptions): DynamicModule {
    const autoRegister = options.exceptions?.autoRegister !== false

    const providers: Provider[] = [
      {
        provide: ALERT_LOGGER_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      {
        provide: ALERT_LOGGER_INSTANCE,
        useFactory: (config: AlertLoggerModuleOptions) =>
          AlertLogger.init(config),
        inject: [ALERT_LOGGER_OPTIONS],
      },
      AlertLoggerService,
    ]

    if (autoRegister) {
      providers.push({
        provide: APP_FILTER,
        useClass: AlertExceptionFilter,
      })
    }

    return {
      module: AlertLoggerModule,
      imports: options.imports ?? [],
      providers,
      exports: [AlertLoggerService, ALERT_LOGGER_INSTANCE],
    }
  }
}
