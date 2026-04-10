// Core
export { AlertLogger } from './core/alert-logger.js'

// Adapters
export type { ConsoleAdapterOptions } from './adapters/console/console-adapter.js'
export { ConsoleAdapter } from './adapters/console/console-adapter.js'
export type { DiscordAdapterOptions } from './adapters/discord/discord-adapter.js'
export { DiscordAdapter } from './adapters/discord/discord-adapter.js'
export type { SlackAdapterOptions } from './adapters/slack/slack-adapter.js'
export { SlackAdapter } from './adapters/slack/slack-adapter.js'
export type { TelegramAdapterOptions } from './adapters/telegram/telegram-adapter.js'
export { TelegramAdapter } from './adapters/telegram/telegram-adapter.js'
// Types
export type {
  AggregationConfig,
  AggregationMeta,
  AggregationPhase,
  Alert,
  AlertAdapter,
  AlertLevel,
  AlertLoggerConfig,
  AlertOptions,
  EnvironmentConfig,
  FingerprintConfig,
  FormattedAlert,
  HealthPolicy,
  NormalizerRule,
  QueueConfig,
  ResolvedConfig,
} from './core/types.js'
