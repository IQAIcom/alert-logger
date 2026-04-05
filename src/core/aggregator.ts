import type { AggregationConfig, AggregationPhase } from './types.js'

export interface AggregationState {
  count: number
  firstSeen: number
  lastSeen: number
  phase: AggregationPhase
  peakRate: number
  lastAlertedAt: number
  lastAlertedCount: number
  rateWindow: number[]
}

export interface AggregationResult {
  shouldSend: boolean
  phase: AggregationPhase
  count: number
  suppressedSince: number
  firstSeen: number
  lastSeen: number
  peakRate: number
  fingerprint: string
}

export interface ResolvedEntry {
  fingerprint: string
  count: number
  firstSeen: number
  lastSeen: number
  peakRate: number
}

const RATE_WINDOW_MS = 60_000
const RESOLUTION_CHECK_INTERVAL_MS = 30_000
const EVICTION_GRACE_MS = 5 * 60_000

function isPowerOfTwo(n: number): boolean {
  return (n & (n - 1)) === 0 && n > 1
}

export class Aggregator {
  private readonly config: AggregationConfig
  private readonly states = new Map<string, AggregationState>()
  private resolutionTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: AggregationConfig) {
    this.config = config
  }

  process(fingerprint: string): AggregationResult {
    const now = Date.now()
    let state = this.states.get(fingerprint)

    if (!state) {
      state = {
        count: 0,
        firstSeen: now,
        lastSeen: now,
        phase: 'onset',
        peakRate: 0,
        lastAlertedAt: 0,
        lastAlertedCount: 0,
        rateWindow: [],
      }
      this.states.set(fingerprint, state)
    }

    state.count++
    state.lastSeen = now

    // Update sliding rate window
    state.rateWindow.push(now)
    const windowCutoff = now - RATE_WINDOW_MS
    state.rateWindow = state.rateWindow.filter((t) => t > windowCutoff)
    const currentRate = state.rateWindow.length / (RATE_WINDOW_MS / 1000)
    if (currentRate > state.peakRate) {
      state.peakRate = currentRate
    }

    const result: AggregationResult = {
      shouldSend: false,
      phase: state.phase,
      count: state.count,
      suppressedSince: 0,
      firstSeen: state.firstSeen,
      lastSeen: state.lastSeen,
      peakRate: state.peakRate,
      fingerprint,
    }

    // Phase: onset
    if (state.count === 1) {
      state.phase = 'onset'
      state.lastAlertedAt = now
      state.lastAlertedCount = state.count
      result.shouldSend = true
      result.phase = 'onset'
      return result
    }

    // Phase: ramp (power-of-2 counts up to rampThreshold)
    if (state.count <= this.config.rampThreshold && isPowerOfTwo(state.count)) {
      state.phase = 'ramp'
      result.shouldSend = true
      result.phase = 'ramp'
      result.suppressedSince = state.count - state.lastAlertedCount
      state.lastAlertedAt = now
      state.lastAlertedCount = state.count
      return result
    }

    // Phase: sustained (count exceeds rampThreshold)
    if (state.count > this.config.rampThreshold) {
      state.phase = 'sustained'
      result.phase = 'sustained'

      if (now - state.lastAlertedAt >= this.config.digestIntervalMs) {
        result.shouldSend = true
        result.suppressedSince = state.count - state.lastAlertedCount
        state.lastAlertedAt = now
        state.lastAlertedCount = state.count
      }

      return result
    }

    // Still in ramp range but not a power of 2 -- suppress
    state.phase = 'ramp'
    result.phase = 'ramp'
    return result
  }

  checkResolutions(): ResolvedEntry[] {
    const now = Date.now()
    const resolved: ResolvedEntry[] = []

    this.states.forEach((state, fingerprint) => {
      // Already resolved -- check if we should evict
      if (state.phase === 'resolution') {
        if (now - state.lastSeen >= this.config.resolutionCooldownMs + EVICTION_GRACE_MS) {
          this.states.delete(fingerprint)
        }
        return
      }

      if (now - state.lastSeen >= this.config.resolutionCooldownMs) {
        state.phase = 'resolution'
        resolved.push({
          fingerprint,
          count: state.count,
          firstSeen: state.firstSeen,
          lastSeen: state.lastSeen,
          peakRate: state.peakRate,
        })
      }
    })

    return resolved
  }

  startResolutionTimer(onResolved: (entry: ResolvedEntry) => void): void {
    if (this.resolutionTimer) return

    this.resolutionTimer = setInterval(() => {
      const resolved = this.checkResolutions()
      for (const entry of resolved) {
        onResolved(entry)
      }
    }, RESOLUTION_CHECK_INTERVAL_MS)

    // Allow the process to exit even if the timer is still running
    if (typeof this.resolutionTimer === 'object' && 'unref' in this.resolutionTimer) {
      this.resolutionTimer.unref()
    }
  }

  destroy(): void {
    if (this.resolutionTimer) {
      clearInterval(this.resolutionTimer)
      this.resolutionTimer = null
    }
    this.states.clear()
  }
}
