export type AlertLevel = 'info' | 'warning' | 'critical'

export type AggregationPhase = 'onset' | 'ramp' | 'sustained' | 'resolution'

export interface AlertOptions {
  fields?: Record<string, string | number | boolean>
  tags?: string[]
  dedupKey?: string
}

export interface Alert {
  level: AlertLevel
  title: string
  message: string
  error?: Error
  options: AlertOptions
  timestamp: number
  serviceName: string
  environment: string
}

export interface AggregationMeta {
  phase: AggregationPhase
  fingerprint: string
  count: number
  suppressedSince: number
  firstSeen: number
  lastSeen: number
  peakRate: number
}

export interface FormattedAlert extends Alert {
  aggregation: AggregationMeta
  webhookUrl?: string
  pings: string[]
  environmentBadge: string
}

export interface AlertAdapter {
  readonly name: string
  levels: AlertLevel[]
  send(alert: FormattedAlert): Promise<void>
  rateLimits(): { maxPerWindow: number; windowMs: number }
  formatAlert?(alert: FormattedAlert): FormattedAlert
  healthy?(): Promise<boolean>
}

export interface NormalizerRule {
  pattern: RegExp
  replacement: string
}

export interface AggregationConfig {
  rampThreshold: number
  digestIntervalMs: number
  resolutionCooldownMs: number
}

export interface RoutingConfig {
  channels?: Partial<Record<AlertLevel, string>>
  tags?: Record<string, string>
  pings?: Partial<Record<AlertLevel, string[]>>
}

export interface QueueConfig {
  maxSize: number
  persistPath: string | null
}

export interface FingerprintConfig {
  stackDepth: number
  normalizers: NormalizerRule[]
}

export interface EnvironmentConfig {
  levels?: AlertLevel[]
  pings?: Partial<Record<AlertLevel, string[]>>
  aggregation?: Partial<AggregationConfig>
}

export interface AlertLoggerConfig {
  adapters: AlertAdapter[]
  serviceName?: string
  environment?: string
  aggregation?: Partial<AggregationConfig>
  routing?: RoutingConfig
  environments?: Record<string, EnvironmentConfig>
  queue?: Partial<QueueConfig>
  fingerprint?: Partial<FingerprintConfig>
}

export interface ResolvedConfig {
  adapters: AlertAdapter[]
  serviceName: string
  environment: string
  aggregation: AggregationConfig
  routing: RoutingConfig
  queue: QueueConfig
  fingerprint: FingerprintConfig
  levels: AlertLevel[]
  pings: Partial<Record<AlertLevel, string[]>>
  environmentBadge: string
}

export const DEFAULT_AGGREGATION: AggregationConfig = {
  rampThreshold: 64,
  digestIntervalMs: 5 * 60_000,
  resolutionCooldownMs: 2 * 60_000,
}

export const DEFAULT_QUEUE: QueueConfig = {
  maxSize: 500,
  persistPath: null,
}

export const DEFAULT_FINGERPRINT: FingerprintConfig = {
  stackDepth: 3,
  normalizers: [],
}

const BADGE_MAP: Record<string, string> = {
  production: '[PROD]',
  staging: '[STG]',
  development: '[DEV]',
}

export function resolveConfig(config: AlertLoggerConfig): ResolvedConfig {
  const environment = config.environment ?? process.env.NODE_ENV ?? 'production'
  const envOverride = config.environments?.[environment]

  const aggregation: AggregationConfig = {
    ...DEFAULT_AGGREGATION,
    ...config.aggregation,
    ...envOverride?.aggregation,
  }

  const pings: Partial<Record<AlertLevel, string[]>> = {
    ...config.routing?.pings,
    ...envOverride?.pings,
  }

  const levels: AlertLevel[] = envOverride?.levels ?? ['info', 'warning', 'critical']

  return {
    adapters: config.adapters,
    serviceName: config.serviceName ?? 'unknown',
    environment,
    aggregation,
    routing: config.routing ?? {},
    queue: { ...DEFAULT_QUEUE, ...config.queue },
    fingerprint: { ...DEFAULT_FINGERPRINT, ...config.fingerprint },
    levels,
    pings,
    environmentBadge: BADGE_MAP[environment] ?? `[${environment.toUpperCase()}]`,
  }
}
