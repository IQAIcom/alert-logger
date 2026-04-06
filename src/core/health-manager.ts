import { loadQueuesFromDisk, saveQueuesToDisk } from './queue-persistence.js'
import type { QueueEntry } from './retry-queue.js'
import { RetryQueue } from './retry-queue.js'
import type { AlertAdapter, FormattedAlert, HealthPolicy } from './types.js'

interface AdapterHealth {
  consecutiveFailures: number
  lastSuccessAt: number
  warnedAt: number | null
  queue: RetryQueue
  draining: boolean
}

interface HealthManagerConfig {
  maxQueueSize: number
  persistPath: string | null
  policy: HealthPolicy
  onRecovery?: (adapterName: string, queuedCount: number, downtimeMs: number) => void
}

export class HealthManager {
  private readonly config: HealthManagerConfig
  private readonly adapters: Map<string, AdapterHealth> = new Map()
  private readonly drainTimers: Map<string, ReturnType<typeof setInterval>> = new Map()

  constructor(config: HealthManagerConfig) {
    this.config = config
  }

  private getOrCreateHealth(adapter: AlertAdapter): AdapterHealth {
    let health = this.adapters.get(adapter.name)
    if (!health) {
      health = {
        consecutiveFailures: 0,
        lastSuccessAt: Date.now(),
        warnedAt: null,
        queue: new RetryQueue(this.config.maxQueueSize),
        draining: false,
      }
      this.adapters.set(adapter.name, health)
    }
    return health
  }

  queueSize(adapter: AlertAdapter): number {
    const health = this.adapters.get(adapter.name)
    return health ? health.queue.size : 0
  }

  isHealthy(adapter: AlertAdapter): boolean {
    const health = this.adapters.get(adapter.name)
    if (!health) return true
    const { unhealthyThreshold, healthWindowMs } = this.config.policy
    return !(
      health.consecutiveFailures >= unhealthyThreshold &&
      Date.now() - health.lastSuccessAt > healthWindowMs
    )
  }

  dispatch(adapter: AlertAdapter, alert: FormattedAlert): void {
    const health = this.getOrCreateHealth(adapter)
    const formatted = adapter.formatAlert ? adapter.formatAlert(alert) : alert

    if (this.isHealthy(adapter) && health.queue.isEmpty) {
      adapter
        .send(formatted)
        .then(
          () => {
            health.consecutiveFailures = 0
            health.lastSuccessAt = Date.now()
          },
          () => {
            health.consecutiveFailures++
            health.queue.enqueue({ alert: formatted, enqueuedAt: Date.now(), retryCount: 0 })

            if (!this.isHealthy(adapter)) {
              if (health.warnedAt === null) {
                console.warn(
                  `[alert-logger] ${adapter.name} adapter is unhealthy (${health.consecutiveFailures} consecutive failures)`,
                )
                health.warnedAt = Date.now()
              }
            }

            this.ensureDrainTimer(adapter)
          },
        )
        .catch(() => {})
    } else {
      if (!this.isHealthy(adapter) && health.warnedAt === null) {
        console.warn(
          `[alert-logger] ${adapter.name} adapter is unhealthy (${health.consecutiveFailures} consecutive failures)`,
        )
        health.warnedAt = Date.now()
      }
      health.queue.enqueue({ alert: formatted, enqueuedAt: Date.now(), retryCount: 0 })
      this.ensureDrainTimer(adapter)
    }
  }

  private ensureDrainTimer(adapter: AlertAdapter): void {
    if (this.drainTimers.has(adapter.name)) return

    const timer = setInterval(() => {
      void this.drainOnce(adapter)
    }, this.config.policy.drainIntervalMs)
    timer.unref?.()
    this.drainTimers.set(adapter.name, timer)
  }

  private async drainOnce(adapter: AlertAdapter): Promise<void> {
    const health = this.adapters.get(adapter.name)
    if (!health || health.draining) return

    health.draining = true

    try {
      const entry = health.queue.peek()
      if (!entry) {
        // Queue empty, stop the timer
        const timer = this.drainTimers.get(adapter.name)
        if (timer) {
          clearInterval(timer)
          this.drainTimers.delete(adapter.name)
        }
        return
      }

      // Discard expired entries, re-drain immediately if more remain
      if (Date.now() - entry.enqueuedAt > this.config.policy.entryExpiryMs) {
        health.queue.dequeue()
        if (!health.queue.isEmpty) {
          setTimeout(() => void this.drainOnce(adapter), 0)
        }
        return
      }

      try {
        await adapter.send(entry.alert)

        // Success: dequeue the entry we peeked
        health.queue.dequeue()

        const wasUnhealthy = health.warnedAt !== null
        const downtimeMs = wasUnhealthy ? Date.now() - health.warnedAt! : 0
        const queuedCount = health.queue.size

        // Mark adapter recovered
        health.consecutiveFailures = 0
        health.lastSuccessAt = Date.now()
        health.warnedAt = null

        // Fire recovery callback only on actual recovery (was warned)
        if (wasUnhealthy && this.config.onRecovery) {
          this.config.onRecovery(adapter.name, queuedCount, downtimeMs)
        }

        // Schedule an immediate re-drain to flush backlog faster on recovery
        if (!health.queue.isEmpty) {
          setTimeout(() => void this.drainOnce(adapter), 100)
        }
      } catch {
        // Send failed — track consecutive failures for health status
        health.consecutiveFailures++
        entry.retryCount++

        // Track unhealthy transition during drain (not just dispatch)
        if (!this.isHealthy(adapter) && health.warnedAt === null) {
          console.warn(
            `[alert-logger] ${adapter.name} adapter is unhealthy (${health.consecutiveFailures} consecutive failures)`,
          )
          health.warnedAt = Date.now()
        }

        if (entry.retryCount >= this.config.policy.maxRetries) {
          health.queue.dequeue()
        }
      }
    } finally {
      health.draining = false
    }
  }

  async save(): Promise<void> {
    if (!this.config.persistPath) return

    const queues = new Map<string, QueueEntry[]>()
    for (const [name, health] of this.adapters) {
      const entries = health.queue.toJSON()
      if (entries.length > 0) {
        queues.set(name, entries)
      }
    }

    await saveQueuesToDisk(this.config.persistPath, queues)
  }

  async load(): Promise<void> {
    if (!this.config.persistPath) return

    const queues = await loadQueuesFromDisk(this.config.persistPath)
    for (const [name, entries] of queues) {
      let health = this.adapters.get(name)
      if (!health) {
        health = {
          consecutiveFailures: 0,
          lastSuccessAt: Date.now(),
          warnedAt: null,
          queue: RetryQueue.fromEntries(entries, this.config.maxQueueSize),
          draining: false,
        }
        this.adapters.set(name, health)
      } else {
        for (const entry of entries) {
          health.queue.enqueue(entry)
        }
      }
    }
  }

  async destroy(): Promise<void> {
    for (const timer of this.drainTimers.values()) {
      clearInterval(timer)
    }
    this.drainTimers.clear()

    if (this.config.persistPath) {
      await this.save()
    }
  }
}
