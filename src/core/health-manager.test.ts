import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDuration, HealthManager } from './health-manager.js'
import type { AlertAdapter, AlertLevel, FormattedAlert } from './types.js'

function createMockAdapter(options?: {
  failCount?: number
}): AlertAdapter & { sent: FormattedAlert[]; callCount: number } {
  let callCount = 0
  const failCount = options?.failCount ?? 0
  return {
    name: 'mock',
    levels: ['info', 'warning', 'critical'] as AlertLevel[],
    sent: [] as FormattedAlert[],
    get callCount() {
      return callCount
    },
    rateLimits: () => ({ maxPerWindow: 100, windowMs: 60_000 }),
    async send(alert: FormattedAlert) {
      callCount++
      if (callCount <= failCount) throw new Error('mock failure')
      this.sent.push(alert)
    },
  }
}

function createAlert(overrides?: Partial<FormattedAlert>): FormattedAlert {
  return {
    level: 'info',
    title: 'test alert',
    message: 'test message',
    options: {},
    timestamp: Date.now(),
    serviceName: 'test-service',
    environment: 'test',
    aggregation: {
      phase: 'onset',
      fingerprint: 'test-fp',
      count: 1,
      suppressedSince: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      peakRate: 0,
    },
    pings: [],
    environmentBadge: '[TEST]',
    ...overrides,
  }
}

describe('HealthManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('healthy adapter: dispatch calls adapter.send directly', async () => {
    const adapter = createMockAdapter()
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })
    const alert = createAlert()

    hm.dispatch(adapter, alert)

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(0)

    expect(adapter.callCount).toBe(1)
    expect(adapter.sent).toHaveLength(1)
    expect(adapter.sent[0]).toEqual(alert)

    await hm.destroy()
  })

  it('FIFO: new alerts enqueue when queue is non-empty even if healthy', async () => {
    const adapter = createMockAdapter({ failCount: 1 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })

    // First dispatch: healthy + empty queue -> sends directly, fails
    hm.dispatch(adapter, createAlert({ title: 'first' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.callCount).toBe(1)

    // Second dispatch: healthy but queue non-empty -> enqueues (FIFO preserved)
    hm.dispatch(adapter, createAlert({ title: 'second' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.callCount).toBe(1) // NOT sent directly

    await hm.destroy()
  })

  it('failed send: increments consecutiveFailures and enqueues', async () => {
    const adapter = createMockAdapter({ failCount: 1 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })
    const alert = createAlert()

    hm.dispatch(adapter, alert)
    await vi.advanceTimersByTimeAsync(0)

    expect(adapter.callCount).toBe(1)
    expect(adapter.sent).toHaveLength(0)
    // Adapter should not be healthy yet (only 1 failure, need 3)
    expect(hm.isHealthy(adapter)).toBe(true)

    await hm.destroy()
  })

  it('unhealthy after 3 failures + 30s: enqueues without calling send', async () => {
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })

    // First dispatch sends directly (queue empty + healthy), fails and enqueues
    hm.dispatch(adapter, createAlert({ title: 'alert-0' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.callCount).toBe(1) // sent directly, but failed

    // Subsequent dispatches go to queue (FIFO: queue is non-empty)
    hm.dispatch(adapter, createAlert({ title: 'alert-1' }))
    hm.dispatch(adapter, createAlert({ title: 'alert-2' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.callCount).toBe(1) // no new sends, queued directly

    // Drain timer retries fail, incrementing consecutiveFailures
    // After first dispatch failure: consecutiveFailures = 1
    // After drain retry failures: consecutiveFailures = 2, 3
    await vi.advanceTimersByTimeAsync(10_000) // drain retry #1 fails
    await vi.advanceTimersByTimeAsync(10_000) // drain retry #2 fails

    // Advance time past 30s threshold from last success
    vi.advanceTimersByTime(31_000)

    // Now the adapter should be unhealthy (3+ failures + >30s since last success)
    expect(hm.isHealthy(adapter)).toBe(false)

    const prevCallCount = adapter.callCount
    // This dispatch should NOT call send (enqueue directly, adapter unhealthy)
    hm.dispatch(adapter, createAlert({ title: 'alert-unhealthy' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(adapter.callCount).toBe(prevCallCount)

    await hm.destroy()
  })

  it('warning emitted once: console.warn called once, not on subsequent failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })

    // First dispatch sends directly (queue empty), fails
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    // Drain retries fail, building up consecutiveFailures
    await vi.advanceTimersByTimeAsync(10_000) // failure #2
    await vi.advanceTimersByTimeAsync(10_000) // failure #3

    // Advance past 30s so lastSuccessAt is stale
    vi.advanceTimersByTime(31_000)

    // Now adapter is unhealthy. Dispatch triggers the warning.
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    const warnCount = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('unhealthy'),
    ).length

    expect(warnCount).toBe(1)

    // Additional dispatches should not produce more warnings
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    const warnCountAfter = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('unhealthy'),
    ).length

    expect(warnCountAfter).toBe(1)

    warnSpy.mockRestore()
    await hm.destroy()
  })

  it('drain timer: on recovery, calls onRecovery callback with stats', async () => {
    const onRecovery = vi.fn()
    // Adapter fails first 3 calls, succeeds after (call 4+)
    const adapter = createMockAdapter({ failCount: 3 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null, onRecovery })

    // Suppress console.warn
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // First dispatch sends directly (queue empty), fails (call 1)
    hm.dispatch(adapter, createAlert({ title: 'fail-0' }))
    await vi.advanceTimersByTimeAsync(0)

    // Queue additional alerts (FIFO: queue non-empty, so these enqueue directly)
    hm.dispatch(adapter, createAlert({ title: 'fail-1' }))
    hm.dispatch(adapter, createAlert({ title: 'queued-while-unhealthy' }))

    // Drain retry fails (call 2) — consecutiveFailures = 2
    await vi.advanceTimersByTimeAsync(10_000)
    // Drain retry fails (call 3) — consecutiveFailures = 3
    await vi.advanceTimersByTimeAsync(10_000)

    // Advance past 30s to make unhealthy + ensure warnedAt gets set on next dispatch
    vi.advanceTimersByTime(31_000)
    hm.dispatch(adapter, createAlert({ title: 'enqueued-unhealthy' }))
    await vi.advanceTimersByTimeAsync(0)

    // Now drain succeeds (call 4) — triggers recovery
    await vi.advanceTimersByTimeAsync(10_000)

    expect(onRecovery).toHaveBeenCalledTimes(1)
    expect(onRecovery).toHaveBeenCalledWith('mock', expect.any(Number), expect.any(Number))

    warnSpy.mockRestore()
    await hm.destroy()
  })

  it('expired entries (>1hr) are discarded during drain', async () => {
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // First dispatch sends directly (queue empty), fails and enqueues
    hm.dispatch(adapter, createAlert({ title: 'fail-0' }))
    await vi.advanceTimersByTimeAsync(0)

    // Queue more alerts (FIFO: queue non-empty)
    hm.dispatch(adapter, createAlert({ title: 'fail-1' }))
    hm.dispatch(adapter, createAlert({ title: 'fail-2' }))

    // Let drain retries fail to build up consecutiveFailures
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)

    // Advance more than 1 hour + 30s (to be unhealthy AND entries expired)
    vi.advanceTimersByTime(3_700_000)

    expect(hm.isHealthy(adapter)).toBe(false)

    // Trigger drain timer - entries should be discarded as expired
    await vi.advanceTimersByTimeAsync(10_000)

    // After the drain runs, entries should have been discarded
    // A second drain should find an empty queue and clear the timer
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)

    warnSpy.mockRestore()
    await hm.destroy()
  })

  it('destroy clears timers', async () => {
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Dispatch a failing alert to start drain timer
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    await hm.destroy()

    expect(clearIntervalSpy).toHaveBeenCalled()

    clearIntervalSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(5_000)).toBe('5s')
    expect(formatDuration(59_000)).toBe('59s')
  })

  it('formats minutes', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(300_000)).toBe('5m')
  })

  it('formats hours', () => {
    expect(formatDuration(3_600_000)).toBe('1h')
    expect(formatDuration(5_400_000)).toBe('1h 30m')
  })
})
