// Core

export type { ConsoleAdapterOptions } from './adapters/console/console-adapter.js'
export { ConsoleAdapter } from './adapters/console/console-adapter.js'
export type { DiscordAdapterOptions } from './adapters/discord/discord-adapter.js'
// Adapters
export { DiscordAdapter } from './adapters/discord/discord-adapter.js'
export { AlertLogger } from './core/alert-logger.js'
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
  NormalizerRule,
  QueueConfig,
  ResolvedConfig,
  RoutingConfig,
} from './core/types.js'
