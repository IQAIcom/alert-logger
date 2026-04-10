export type AlertLevel = 'info' | 'warning' | 'critical'

export type AggregationPhase = 'onset' | 'ramp' | 'sustained' | 'resolution'

export interface AlertOptions {
  /** Detailed message shown in the embed body/description. When omitted, the title is used. */
  description?: string
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

export interface HealthPolicy {
  /** Number of consecutive failures before marking adapter unhealthy (default: 3) */
  unhealthyThreshold: number
  /** Time since last success before health check fails, in ms (default: 30000) */
  healthWindowMs: number
  /** Interval between queue drain attempts, in ms (default: 10000) */
  drainIntervalMs: number
  /** Max retries before discarding a queued entry (default: 3) */
  maxRetries: number
  /** Time after which queued entries are discarded, in ms (default: 3600000) */
  entryExpiryMs: number
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
  aggregation?: Partial<AggregationConfig>
}

export interface AlertLoggerConfig {
  adapters: AlertAdapter[]
  serviceName?: string
  environment?: string
  aggregation?: Partial<AggregationConfig>
  environments?: Record<string, EnvironmentConfig>
  queue?: Partial<QueueConfig>
  health?: Partial<HealthPolicy>
  fingerprint?: Partial<FingerprintConfig>
}

export interface ResolvedConfig {
  adapters: AlertAdapter[]
  serviceName: string
  environment: string
  aggregation: AggregationConfig
  queue: QueueConfig
  health: HealthPolicy
  fingerprint: FingerprintConfig
  levels: AlertLevel[]
  environmentBadge: string
}

export const DEFAULT_AGGREGATION: AggregationConfig = {
  rampThreshold: 64,
  digestIntervalMs: 5 * 60_000,
  resolutionCooldownMs: 2 * 60_000,
}

export const DEFAULT_HEALTH: HealthPolicy = {
  unhealthyThreshold: 3,
  healthWindowMs: 30_000,
  drainIntervalMs: 10_000,
  maxRetries: 3,
  entryExpiryMs: 3_600_000,
}

export const DEFAULT_QUEUE: QueueConfig = {
  maxSize: 500,
  persistPath: null,
}

export const DEFAULT_FINGERPRINT: FingerprintConfig = {
  stackDepth: 1,
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

  const levels: AlertLevel[] = envOverride?.levels ?? ['info', 'warning', 'critical']

  return {
    adapters: config.adapters,
    serviceName: config.serviceName ?? 'unknown',
    environment,
    aggregation,
    queue: { ...DEFAULT_QUEUE, ...config.queue },
    health: { ...DEFAULT_HEALTH, ...config.health },
    fingerprint: { ...DEFAULT_FINGERPRINT, ...config.fingerprint },
    levels,
    environmentBadge: BADGE_MAP[environment] ?? `[${environment.toUpperCase()}]`,
  }
}
