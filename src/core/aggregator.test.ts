import { Aggregator } from './aggregator.js'
import type { AggregationConfig } from './types.js'
import { DEFAULT_AGGREGATION } from './types.js'

describe('Aggregator', () => {
  let aggregator: Aggregator

  beforeEach(() => {
    vi.useFakeTimers()
    aggregator = new Aggregator(DEFAULT_AGGREGATION)
  })

  afterEach(() => {
    aggregator.destroy()
    vi.useRealTimers()
  })

  describe('onset phase', () => {
    it('sends on first occurrence with phase onset', () => {
      const result = aggregator.process('err-1')

      expect(result.shouldSend).toBe(true)
      expect(result.phase).toBe('onset')
      expect(result.count).toBe(1)
      expect(result.fingerprint).toBe('err-1')
      expect(result.suppressedSince).toBe(0)
    })

    it('tracks firstSeen and lastSeen on first occurrence', () => {
      const now = Date.now()
      const result = aggregator.process('err-1')

      expect(result.firstSeen).toBe(now)
      expect(result.lastSeen).toBe(now)
    })
  })

  describe('ramp phase', () => {
    it('sends at power-of-2 counts (2, 4, 8, 16, 32, 64)', () => {
      const powerOfTwoCounts = [2, 4, 8, 16, 32, 64]

      for (let i = 1; i <= 64; i++) {
        const result = aggregator.process('err-ramp')
        if (powerOfTwoCounts.includes(i)) {
          expect(result.shouldSend).toBe(true)
          expect(result.phase).toBe('ramp')
          expect(result.count).toBe(i)
        }
      }
    })

    it('suppresses non-power-of-2 counts', () => {
      const suppressedCounts = [3, 5, 6, 7]

      for (let i = 1; i <= 7; i++) {
        const result = aggregator.process('err-suppress')
        if (suppressedCounts.includes(i)) {
          expect(result.shouldSend).toBe(false)
          expect(result.phase).toBe('ramp')
        }
      }
    })

    it('does not send at count 1 with ramp phase (onset handles count 1)', () => {
      const result = aggregator.process('err-first')
      expect(result.phase).toBe('onset')
      expect(result.shouldSend).toBe(true)

      // count 2 should be ramp
      const result2 = aggregator.process('err-first')
      expect(result2.phase).toBe('ramp')
      expect(result2.shouldSend).toBe(true)
      expect(result2.count).toBe(2)
    })
  })

  describe('sustained phase', () => {
    function processNTimes(fp: string, n: number) {
      let lastResult: ReturnType<typeof aggregator.process> | undefined
      for (let i = 0; i < n; i++) {
        lastResult = aggregator.process(fp)
      }
      return lastResult!
    }

    it('transitions to sustained when count exceeds rampThreshold', () => {
      // Process 64 (last ramp send) then one more to exceed threshold
      const result = processNTimes('err-sustained', 65)

      expect(result.phase).toBe('sustained')
      expect(result.count).toBe(65)
    })

    it('sends digest when digestIntervalMs has elapsed', () => {
      // Get past ramp phase
      processNTimes('err-digest', 65)

      // Advance time past digestIntervalMs (default 5 minutes)
      vi.advanceTimersByTime(DEFAULT_AGGREGATION.digestIntervalMs)

      const result = aggregator.process('err-digest')
      expect(result.shouldSend).toBe(true)
      expect(result.phase).toBe('sustained')
    })

    it('suppresses when digestIntervalMs has not elapsed', () => {
      processNTimes('err-no-digest', 65)

      // Advance only half the digest interval
      vi.advanceTimersByTime(DEFAULT_AGGREGATION.digestIntervalMs / 2)

      const result = aggregator.process('err-no-digest')
      expect(result.shouldSend).toBe(false)
      expect(result.phase).toBe('sustained')
    })
  })

  describe('suppressedSince tracking', () => {
    it('reports correct suppressed count in ramp phase', () => {
      // count 1: onset, alerted at count 1
      aggregator.process('err-sup')
      // count 2: ramp, power of 2 -> send. suppressedSince = 2 - 1 = 1
      const r2 = aggregator.process('err-sup')
      expect(r2.shouldSend).toBe(true)
      expect(r2.suppressedSince).toBe(1)

      // count 3: suppressed
      aggregator.process('err-sup')
      // count 4: ramp, power of 2 -> send. suppressedSince = 4 - 2 = 2
      const r4 = aggregator.process('err-sup')
      expect(r4.shouldSend).toBe(true)
      expect(r4.suppressedSince).toBe(2)
    })

    it('reports correct suppressed count in sustained phase', () => {
      const config: AggregationConfig = {
        rampThreshold: 4,
        digestIntervalMs: 1000,
        resolutionCooldownMs: 5000,
      }
      const agg = new Aggregator(config)

      // 1: onset (alerted at 1), 2: ramp (alerted at 2), 3: suppressed, 4: ramp (alerted at 4)
      agg.process('fp')
      agg.process('fp')
      agg.process('fp')
      agg.process('fp')

      // 5, 6, 7: sustained but no digest yet
      agg.process('fp')
      agg.process('fp')
      agg.process('fp')

      // Advance past digest interval
      vi.advanceTimersByTime(1000)

      // count 8: sustained, digest fires. suppressedSince = 8 - 4 = 4
      const result = agg.process('fp')
      expect(result.shouldSend).toBe(true)
      expect(result.phase).toBe('sustained')
      expect(result.suppressedSince).toBe(4)

      agg.destroy()
    })

    it('reports zero suppressedSince on onset', () => {
      const result = aggregator.process('fp-zero')
      expect(result.suppressedSince).toBe(0)
    })
  })

  describe('resolution detection', () => {
    it('detects entries past the cooldown as resolved', () => {
      aggregator.process('err-resolve')

      // Advance past resolution cooldown (default 2 minutes)
      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs + 1)

      const resolved = aggregator.checkResolutions()
      expect(resolved).toHaveLength(1)
      expect(resolved[0].fingerprint).toBe('err-resolve')
      expect(resolved[0].count).toBe(1)
    })

    it('does not resolve entries that are still active', () => {
      aggregator.process('err-active')

      // Advance less than cooldown
      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs - 1)

      const resolved = aggregator.checkResolutions()
      expect(resolved).toHaveLength(0)
    })

    it('does not re-resolve already resolved entries', () => {
      aggregator.process('err-once')

      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs + 1)

      const first = aggregator.checkResolutions()
      expect(first).toHaveLength(1)

      // Calling again should not return the same entry
      const second = aggregator.checkResolutions()
      expect(second).toHaveLength(0)
    })

    it('includes peakRate and timing info in resolved entries', () => {
      const startTime = Date.now()
      aggregator.process('err-info')

      vi.advanceTimersByTime(1000)
      aggregator.process('err-info')

      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs + 1)

      const resolved = aggregator.checkResolutions()
      expect(resolved[0].firstSeen).toBe(startTime)
      expect(resolved[0].lastSeen).toBe(startTime + 1000)
      expect(resolved[0].peakRate).toBeGreaterThan(0)
    })
  })

  describe('state cleanup', () => {
    it('evicts entries after resolution + grace period (5 minutes)', () => {
      aggregator.process('err-evict')

      // Advance past cooldown to trigger resolution
      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs + 1)
      aggregator.checkResolutions()

      // Advance past the grace period (5 minutes)
      vi.advanceTimersByTime(5 * 60_000 + 1)
      aggregator.checkResolutions() // triggers eviction check

      // Processing the same fingerprint should create a fresh onset
      const result = aggregator.process('err-evict')
      expect(result.phase).toBe('onset')
      expect(result.count).toBe(1)
    })

    it('does not evict entries before grace period expires', () => {
      aggregator.process('err-keep')

      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs + 1)
      aggregator.checkResolutions()

      // Advance less than grace period
      vi.advanceTimersByTime(4 * 60_000)
      aggregator.checkResolutions()

      // Processing should NOT create a fresh onset (state still exists in resolution)
      // The entry is still in the map with phase 'resolution', but process() will
      // increment the existing state
      const result = aggregator.process('err-keep')
      expect(result.count).toBe(2)
    })
  })

  describe('startResolutionTimer', () => {
    it('calls onResolved callback for resolved entries', () => {
      const onResolved = vi.fn()
      aggregator.process('err-timer')
      aggregator.startResolutionTimer(onResolved)

      // Advance past cooldown + the 30s check interval
      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs + 30_000 + 1)

      expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'err-timer' }))
    })

    it('does not start multiple timers', () => {
      const onResolved1 = vi.fn()
      const onResolved2 = vi.fn()

      aggregator.startResolutionTimer(onResolved1)
      aggregator.startResolutionTimer(onResolved2)

      aggregator.process('err-multi')

      vi.advanceTimersByTime(DEFAULT_AGGREGATION.resolutionCooldownMs + 30_000 + 1)

      // Only the first callback should be registered
      expect(onResolved1).toHaveBeenCalled()
      expect(onResolved2).not.toHaveBeenCalled()
    })
  })

  describe('destroy', () => {
    it('clears all state and stops timers', () => {
      aggregator.process('err-destroy')
      aggregator.startResolutionTimer(vi.fn())
      aggregator.destroy()

      // After destroy, a new process call should start fresh
      const result = aggregator.process('err-destroy')
      expect(result.phase).toBe('onset')
      expect(result.count).toBe(1)
    })
  })
})
