import type { AggregationConfig, AggregationPhase } from './types.js'

export interface AggregationState {
  count: number
  firstSeen: number
  lastSeen: number
  phase: AggregationPhase
  everEnteredSustained: boolean
  hasSentRampAlert: boolean
  peakRate: number
  lastAlertedAt: number
  lastAlertedCount: number
  rateWindow: number[]
}

export interface AggregationResult {
  shouldSend: boolean
  phase: AggregationPhase
  count: number
  periodCount: number
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
        everEnteredSustained: false,
        hasSentRampAlert: false,
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
    const windowCutoff = now - this.config.rampExitRateWindowMs
    state.rateWindow = state.rateWindow.filter((t) => t > windowCutoff)
    const currentRate = state.rateWindow.length / (this.config.rampExitRateWindowMs / 1000)
    if (currentRate > state.peakRate) {
      state.peakRate = currentRate
    }

    const result: AggregationResult = {
      shouldSend: false,
      phase: state.phase,
      count: state.count,
      periodCount: 0,
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

    const shouldEnterSustainedByRate =
      state.hasSentRampAlert && currentRate >= this.config.rampExitRatePerSecond

    if (state.count > this.config.rampThreshold || shouldEnterSustainedByRate) {
      state.phase = 'sustained'
      state.everEnteredSustained = true
      result.phase = 'sustained'

      const sustainedByRate = shouldEnterSustainedByRate && state.count <= this.config.rampThreshold
      if (sustainedByRate || now - state.lastAlertedAt >= this.config.digestIntervalMs) {
        result.shouldSend = true
        result.periodCount = state.count - state.lastAlertedCount
        result.suppressedSince = result.periodCount
        state.lastAlertedAt = now
        state.lastAlertedCount = state.count
      }

      return result
    }

    // Phase: ramp (power-of-2 counts up to rampThreshold)
    if (isPowerOfTwo(state.count)) {
      state.phase = 'ramp'
      result.shouldSend = true
      result.phase = 'ramp'
      result.periodCount = state.count - state.lastAlertedCount
      result.suppressedSince = result.periodCount
      state.lastAlertedAt = now
      state.lastAlertedCount = state.count
      state.hasSentRampAlert = true
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
        // Only send resolution for alerts that ever reached sustained mode.
        if (state.everEnteredSustained) {
          resolved.push({
            fingerprint,
            count: state.count,
            firstSeen: state.firstSeen,
            lastSeen: state.lastSeen,
            peakRate: state.peakRate,
          })
        }
        state.phase = 'resolution'
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
