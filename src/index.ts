// Core
export { AlertLogger } from './core/alert-logger.js'

// Types
export type {
  AlertLevel,
  AggregationPhase,
  Alert,
  AlertOptions,
  FormattedAlert,
  AggregationMeta,
  AlertAdapter,
  AlertLoggerConfig,
  ResolvedConfig,
  RoutingConfig,
  AggregationConfig,
  QueueConfig,
  FingerprintConfig,
  NormalizerRule,
  EnvironmentConfig,
} from './core/types.js'

// Adapters
export { DiscordAdapter } from './adapters/discord/discord-adapter.js'
export type { DiscordAdapterOptions } from './adapters/discord/discord-adapter.js'
export { ConsoleAdapter } from './adapters/console/console-adapter.js'
export type { ConsoleAdapterOptions } from './adapters/console/console-adapter.js'
