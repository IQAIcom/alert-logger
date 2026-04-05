import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { access, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { saveQueuesToDisk, loadQueuesFromDisk } from './queue-persistence.js'
import type { QueueEntry } from './retry-queue.js'
import type { FormattedAlert } from './types.js'

function tmpPath(): string {
  return join(tmpdir(), `alert-logger-test-${randomUUID()}.json`)
}

function makeEntry(overrides?: Partial<QueueEntry>): QueueEntry {
  const alert: FormattedAlert = {
    level: 'critical',
    title: 'Test alert',
    message: 'Something went wrong',
    options: {},
    timestamp: Date.now(),
    serviceName: 'test-service',
    environment: 'production',
    aggregation: {
      phase: 'onset',
      fingerprint: 'abc123',
      count: 1,
      suppressedSince: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      peakRate: 1,
    },
    pings: [],
    environmentBadge: '[PROD]',
  }

  return {
    alert,
    enqueuedAt: Date.now(),
    retryCount: 0,
    ...overrides,
  }
}

const cleanupPaths: string[] = []

afterEach(async () => {
  for (const p of cleanupPaths) {
    await rm(p, { force: true })
    await rm(`${p}.tmp`, { force: true })
  }
  cleanupPaths.length = 0
})

describe('queue-persistence', () => {
  describe('saveQueuesToDisk', () => {
    it('writes file atomically', async () => {
      const path = tmpPath()
      cleanupPaths.push(path)

      const queues = new Map<string, QueueEntry[]>()
      queues.set('discord', [makeEntry()])
      queues.set('slack', [makeEntry(), makeEntry()])

      await saveQueuesToDisk(path, queues)

      // File should exist at the final path
      await expect(access(path)).resolves.toBeUndefined()
    })
  })

  describe('loadQueuesFromDisk', () => {
    it('reads saved data correctly (roundtrip)', async () => {
      const path = tmpPath()
      cleanupPaths.push(path)

      const entry1 = makeEntry({ retryCount: 2 })
      const entry2 = makeEntry({ retryCount: 5 })

      const queues = new Map<string, QueueEntry[]>()
      queues.set('discord', [entry1])
      queues.set('slack', [entry2])

      await saveQueuesToDisk(path, queues)
      const loaded = await loadQueuesFromDisk(path)

      expect(loaded.size).toBe(2)
      expect(loaded.get('discord')).toHaveLength(1)
      expect(loaded.get('discord')![0].retryCount).toBe(2)
      expect(loaded.get('slack')).toHaveLength(1)
      expect(loaded.get('slack')![0].retryCount).toBe(5)
      expect(loaded.get('slack')![0].alert.title).toBe('Test alert')
    })

    it('returns empty Map when file does not exist', async () => {
      const path = tmpPath()
      // Intentionally don't create the file
      const loaded = await loadQueuesFromDisk(path)

      expect(loaded).toBeInstanceOf(Map)
      expect(loaded.size).toBe(0)
    })

    it('returns empty Map on corrupt file and logs warning', async () => {
      const path = tmpPath()
      cleanupPaths.push(path)

      await writeFile(path, '{{{not valid json!!!', 'utf-8')

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const loaded = await loadQueuesFromDisk(path)

      expect(loaded).toBeInstanceOf(Map)
      expect(loaded.size).toBe(0)
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0][0]).toContain('Failed to parse')

      warnSpy.mockRestore()
    })
  })
})
