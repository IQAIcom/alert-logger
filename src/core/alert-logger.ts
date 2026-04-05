import { fingerprint } from './fingerprinter.js'
import { Aggregator, type ResolvedEntry } from './aggregator.js'
import { Router } from './router.js'
import { HealthManager, formatDuration } from './health-manager.js'
import type {
  AlertLevel,
  AlertLoggerConfig,
  AlertOptions,
  FormattedAlert,
  ResolvedConfig,
  AlertAdapter,
} from './types.js'
import { resolveConfig } from './types.js'

interface AlertMeta {
  level: AlertLevel
  title: string
  options: AlertOptions
}

export class AlertLogger {
  private static instance: AlertLogger | null = null

  private readonly config: ResolvedConfig
  private readonly aggregator: Aggregator
  private readonly router: Router
  private readonly adapters: AlertAdapter[]
  private readonly healthManager: HealthManager
  /** Track original alert metadata per fingerprint for resolution messages */
  private readonly alertMeta = new Map<string, AlertMeta>()

  private constructor(config: ResolvedConfig) {
    this.config = config
    this.aggregator = new Aggregator(config.aggregation)
    this.router = new Router(config.routing, config.pings)
    this.adapters = config.adapters
    this.healthManager = new HealthManager({
      maxQueueSize: config.queue.maxSize,
      persistPath: config.queue.persistPath,
      onRecovery: (adapterName, queuedCount, downtimeMs) => {
        this.handleAdapterRecovery(adapterName, queuedCount, downtimeMs)
      },
    })

    // Load persisted queues from disk (best-effort, non-blocking)
    void this.healthManager.load()

    this.aggregator.startResolutionTimer((entry) => {
      this.handleResolution(entry)
    })
  }

  static init(config: AlertLoggerConfig): AlertLogger {
    const resolved = resolveConfig(config)
    const instance = new AlertLogger(resolved)
    AlertLogger.instance = instance
    return instance
  }

  static getInstance(): AlertLogger {
    if (!AlertLogger.instance) {
      throw new Error(
        'AlertLogger not initialized. Call AlertLogger.init() first.',
      )
    }
    return AlertLogger.instance
  }

  /** Reset the singleton — primarily for testing. */
  static reset(): void {
    if (AlertLogger.instance) {
      // Fire-and-forget: destroy is async but reset is used in tests
      void AlertLogger.instance.destroy()
      AlertLogger.instance = null
    }
  }

  info(title: string, options?: AlertOptions): void {
    this.log('info', title, title, undefined, options)
  }

  warn(title: string, options?: AlertOptions): void {
    this.log('warning', title, title, undefined, options)
  }

  error(title: string, error?: Error | string, options?: AlertOptions): void {
    const [err, opts] = this.normalizeErrorArgs(error, options)
    const message = err?.message ?? title
    this.log('critical', title, message, err, opts)
  }

  critical(
    title: string,
    error?: Error | string,
    options?: AlertOptions,
  ): void {
    const [err, opts] = this.normalizeErrorArgs(error, options)
    const message = err?.message ?? title
    this.log('critical', title, message, err, opts)
  }

  async destroy(): Promise<void> {
    this.aggregator.destroy()
    await this.healthManager.destroy()
  }

  private log(
    level: AlertLevel,
    title: string,
    message: string,
    error: Error | undefined,
    options?: AlertOptions,
  ): void {
    // Check if this level is enabled for the current environment
    if (!this.config.levels.includes(level)) return

    const opts: AlertOptions = options ?? {}
    const fp = fingerprint(
      title,
      message,
      error,
      this.config.fingerprint,
      opts.dedupKey,
    )

    // Store metadata for resolution messages
    if (!this.alertMeta.has(fp)) {
      this.alertMeta.set(fp, { level, title, options: opts })
    }

    const result = this.aggregator.process(fp)
    if (!result.shouldSend) return

    const routing = this.router.route(level, opts.tags)

    const formatted: FormattedAlert = {
      level,
      title,
      message,
      error,
      options: opts,
      timestamp: Date.now(),
      serviceName: this.config.serviceName,
      environment: this.config.environment,
      aggregation: {
        phase: result.phase,
        fingerprint: fp,
        count: result.count,
        suppressedSince: result.suppressedSince,
        firstSeen: result.firstSeen,
        lastSeen: result.lastSeen,
        peakRate: result.peakRate,
      },
      webhookUrl: routing.webhookUrl,
      pings: routing.pings,
      environmentBadge: this.config.environmentBadge,
    }

    this.sendToAdapters(formatted)
  }

  private handleResolution(entry: ResolvedEntry): void {
    const meta = this.alertMeta.get(entry.fingerprint)
    this.alertMeta.delete(entry.fingerprint)

    const formatted: FormattedAlert = {
      level: meta?.level ?? 'info',
      title: meta?.title ?? `Alert ${entry.fingerprint.slice(0, 8)}`,
      message: '',
      options: meta?.options ?? {},
      timestamp: Date.now(),
      serviceName: this.config.serviceName,
      environment: this.config.environment,
      aggregation: {
        phase: 'resolution',
        fingerprint: entry.fingerprint,
        count: entry.count,
        suppressedSince: 0,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        peakRate: entry.peakRate,
      },
      pings: [],
      environmentBadge: this.config.environmentBadge,
    }

    this.sendToAdapters(formatted)
  }

  private handleAdapterRecovery(
    adapterName: string,
    queuedCount: number,
    downtimeMs: number,
  ): void {
    const durationStr = formatDuration(downtimeMs)
    const recovery: FormattedAlert = {
      level: 'info',
      title: `${adapterName} adapter recovered`,
      message: `${queuedCount} alerts queued during ${durationStr} of downtime`,
      options: {
        fields: {
          queuedAlerts: String(queuedCount),
          downtime: durationStr,
        },
      },
      timestamp: Date.now(),
      serviceName: this.config.serviceName,
      environment: this.config.environment,
      aggregation: {
        phase: 'resolution',
        fingerprint: `health-recovery-${adapterName}`,
        count: 1,
        suppressedSince: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        peakRate: 0,
      },
      pings: [],
      environmentBadge: this.config.environmentBadge,
    }

    // Send recovery notification to the recovered adapter
    const adapter = this.adapters.find((a) => a.name === adapterName)
    if (adapter) {
      adapter.send(recovery).catch(() => {})
    }
  }

  private sendToAdapters(alert: FormattedAlert): void {
    for (const adapter of this.adapters) {
      if (!adapter.levels.includes(alert.level) && alert.aggregation.phase !== 'resolution') {
        continue
      }

      this.healthManager.dispatch(adapter, alert)
    }
  }

  private normalizeErrorArgs(
    error?: Error | string,
    options?: AlertOptions,
  ): [Error | undefined, AlertOptions | undefined] {
    if (typeof error === 'string') {
      return [new Error(error), options]
    }
    return [error, options]
  }
}
