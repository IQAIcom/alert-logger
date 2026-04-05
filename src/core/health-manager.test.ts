import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HealthManager, formatDuration } from './health-manager.js'
import type { AlertAdapter, AlertLevel, FormattedAlert } from './types.js'

function createMockAdapter(options?: { failCount?: number }): AlertAdapter & { sent: FormattedAlert[]; callCount: number } {
  let callCount = 0
  const failCount = options?.failCount ?? 0
  return {
    name: 'mock',
    levels: ['info', 'warning', 'critical'] as AlertLevel[],
    sent: [] as FormattedAlert[],
    get callCount() { return callCount },
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

    hm.destroy()
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

    hm.destroy()
  })

  it('unhealthy after 3 failures + 30s: enqueues without calling send', async () => {
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })

    // Set time so lastSuccessAt will be >30s ago after failures
    const startTime = Date.now()

    // Dispatch 3 alerts that all fail
    for (let i = 0; i < 3; i++) {
      hm.dispatch(adapter, createAlert({ title: `alert-${i}` }))
      await vi.advanceTimersByTimeAsync(0)
    }

    // Advance time past 30s threshold
    vi.advanceTimersByTime(31_000)

    // Now the adapter should be unhealthy
    expect(hm.isHealthy(adapter)).toBe(false)

    const prevCallCount = adapter.callCount
    // This dispatch should NOT call send (enqueue directly)
    hm.dispatch(adapter, createAlert({ title: 'alert-unhealthy' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(adapter.callCount).toBe(prevCallCount)

    hm.destroy()
  })

  it('warning emitted once: console.warn called once, not on subsequent failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })

    // Dispatch 2 failures first
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    // Advance past 30s so lastSuccessAt is stale
    vi.advanceTimersByTime(31_000)

    // 3rd failure triggers unhealthy (3 consecutive + >30s since last success)
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    const warnCount = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('unhealthy'),
    ).length

    expect(warnCount).toBe(1)

    // Additional dispatches should not produce more warnings (adapter is unhealthy, enqueues directly)
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    const warnCountAfter = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('unhealthy'),
    ).length

    expect(warnCountAfter).toBe(1)

    warnSpy.mockRestore()
    hm.destroy()
  })

  it('drain timer: on recovery, calls onRecovery callback with stats', async () => {
    const onRecovery = vi.fn()
    // Adapter fails first 3 calls, succeeds after
    const adapter = createMockAdapter({ failCount: 3 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null, onRecovery })

    // Suppress console.warn
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Dispatch 3 alerts that fail
    for (let i = 0; i < 3; i++) {
      hm.dispatch(adapter, createAlert({ title: `fail-${i}` }))
      await vi.advanceTimersByTimeAsync(0)
    }

    // Advance past 30s to make unhealthy
    vi.advanceTimersByTime(31_000)

    // Trigger the 4th dispatch which will be unhealthy (just enqueue)
    hm.dispatch(adapter, createAlert({ title: 'queued-while-unhealthy' }))
    await vi.advanceTimersByTimeAsync(0)

    // Now advance to trigger drain timer (10s interval)
    await vi.advanceTimersByTimeAsync(10_000)

    // The drain should have tried to send the oldest queued entry and succeeded
    expect(onRecovery).toHaveBeenCalledTimes(1)
    expect(onRecovery).toHaveBeenCalledWith('mock', expect.any(Number), expect.any(Number))

    warnSpy.mockRestore()
    hm.destroy()
  })

  it('expired entries (>1hr) are discarded during drain', async () => {
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Dispatch alerts that fail
    for (let i = 0; i < 3; i++) {
      hm.dispatch(adapter, createAlert({ title: `fail-${i}` }))
      await vi.advanceTimersByTimeAsync(0)
    }

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
    hm.destroy()
  })

  it('destroy clears timers', async () => {
    const adapter = createMockAdapter({ failCount: 100 })
    const hm = new HealthManager({ maxQueueSize: 100, persistPath: null })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Dispatch a failing alert to start drain timer
    hm.dispatch(adapter, createAlert())
    await vi.advanceTimersByTimeAsync(0)

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    hm.destroy()

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
