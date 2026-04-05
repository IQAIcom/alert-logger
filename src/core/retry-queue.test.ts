import { RetryQueue, type QueueEntry } from './retry-queue.js'
import type { FormattedAlert } from './types.js'

function makeEntry(id: number): QueueEntry {
  return {
    alert: {
      level: 'critical',
      title: `Alert ${id}`,
      message: `Message ${id}`,
      options: {},
      timestamp: Date.now(),
      serviceName: 'test',
      environment: 'test',
      aggregation: {
        phase: 'onset',
        fingerprint: `fp-${id}`,
        count: 1,
        suppressedSince: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        peakRate: 0,
      },
      pings: [],
      environmentBadge: '[TEST]',
    } as FormattedAlert,
    enqueuedAt: Date.now(),
    retryCount: 0,
  }
}

describe('RetryQueue', () => {
  describe('basic enqueue/dequeue FIFO ordering', () => {
    it('returns entries in the order they were enqueued', () => {
      const queue = new RetryQueue(5)
      const e1 = makeEntry(1)
      const e2 = makeEntry(2)
      const e3 = makeEntry(3)

      queue.enqueue(e1)
      queue.enqueue(e2)
      queue.enqueue(e3)

      expect(queue.dequeue()).toBe(e1)
      expect(queue.dequeue()).toBe(e2)
      expect(queue.dequeue()).toBe(e3)
    })
  })

  describe('ring buffer overflow', () => {
    it('overwrites oldest entry when full', () => {
      const queue = new RetryQueue(3)
      const e1 = makeEntry(1)
      const e2 = makeEntry(2)
      const e3 = makeEntry(3)
      const e4 = makeEntry(4)

      queue.enqueue(e1)
      queue.enqueue(e2)
      queue.enqueue(e3)
      queue.enqueue(e4) // overwrites e1

      expect(queue.size).toBe(3)
      expect(queue.dequeue()).toBe(e2)
      expect(queue.dequeue()).toBe(e3)
      expect(queue.dequeue()).toBe(e4)
    })

    it('overwrites multiple oldest entries when overfilled', () => {
      const queue = new RetryQueue(2)
      const e1 = makeEntry(1)
      const e2 = makeEntry(2)
      const e3 = makeEntry(3)
      const e4 = makeEntry(4)

      queue.enqueue(e1)
      queue.enqueue(e2)
      queue.enqueue(e3)
      queue.enqueue(e4)

      expect(queue.size).toBe(2)
      expect(queue.dequeue()).toBe(e3)
      expect(queue.dequeue()).toBe(e4)
    })
  })

  describe('peek', () => {
    it('returns the oldest entry without removing it', () => {
      const queue = new RetryQueue(5)
      const e1 = makeEntry(1)
      const e2 = makeEntry(2)

      queue.enqueue(e1)
      queue.enqueue(e2)

      expect(queue.peek()).toBe(e1)
      expect(queue.peek()).toBe(e1)
      expect(queue.size).toBe(2)
    })

    it('returns undefined on empty queue', () => {
      const queue = new RetryQueue(5)
      expect(queue.peek()).toBeUndefined()
    })
  })

  describe('drain', () => {
    it('returns all entries in FIFO order and empties the queue', () => {
      const queue = new RetryQueue(5)
      const e1 = makeEntry(1)
      const e2 = makeEntry(2)
      const e3 = makeEntry(3)

      queue.enqueue(e1)
      queue.enqueue(e2)
      queue.enqueue(e3)

      const drained = queue.drain()

      expect(drained).toEqual([e1, e2, e3])
      expect(queue.isEmpty).toBe(true)
      expect(queue.size).toBe(0)
    })

    it('returns empty array on empty queue', () => {
      const queue = new RetryQueue(5)
      expect(queue.drain()).toEqual([])
    })
  })

  describe('size / isEmpty / isFull getters', () => {
    it('reports correct size', () => {
      const queue = new RetryQueue(3)
      expect(queue.size).toBe(0)

      queue.enqueue(makeEntry(1))
      expect(queue.size).toBe(1)

      queue.enqueue(makeEntry(2))
      queue.enqueue(makeEntry(3))
      expect(queue.size).toBe(3)
    })

    it('isEmpty is true only when empty', () => {
      const queue = new RetryQueue(3)
      expect(queue.isEmpty).toBe(true)

      queue.enqueue(makeEntry(1))
      expect(queue.isEmpty).toBe(false)

      queue.dequeue()
      expect(queue.isEmpty).toBe(true)
    })

    it('isFull is true only when at capacity', () => {
      const queue = new RetryQueue(2)
      expect(queue.isFull).toBe(false)

      queue.enqueue(makeEntry(1))
      expect(queue.isFull).toBe(false)

      queue.enqueue(makeEntry(2))
      expect(queue.isFull).toBe(true)

      queue.dequeue()
      expect(queue.isFull).toBe(false)
    })
  })

  describe('toJSON / fromEntries roundtrip', () => {
    it('serializes and reconstructs the queue', () => {
      const queue = new RetryQueue(5)
      const e1 = makeEntry(1)
      const e2 = makeEntry(2)
      const e3 = makeEntry(3)

      queue.enqueue(e1)
      queue.enqueue(e2)
      queue.enqueue(e3)

      const json = queue.toJSON()
      expect(json).toEqual([e1, e2, e3])

      const restored = RetryQueue.fromEntries(json, 5)
      expect(restored.size).toBe(3)
      expect(restored.dequeue()).toEqual(e1)
      expect(restored.dequeue()).toEqual(e2)
      expect(restored.dequeue()).toEqual(e3)
    })

    it('toJSON returns entries in FIFO order after wraparound', () => {
      const queue = new RetryQueue(3)
      queue.enqueue(makeEntry(1))
      queue.enqueue(makeEntry(2))
      queue.enqueue(makeEntry(3))
      queue.dequeue() // remove first, head advances
      queue.enqueue(makeEntry(4)) // wraps around

      const json = queue.toJSON()
      expect(json.map(e => e.alert.title)).toEqual([
        'Alert 2',
        'Alert 3',
        'Alert 4',
      ])
    })
  })

  describe('empty dequeue', () => {
    it('returns undefined when queue is empty', () => {
      const queue = new RetryQueue(5)
      expect(queue.dequeue()).toBeUndefined()
    })

    it('returns undefined after all entries are dequeued', () => {
      const queue = new RetryQueue(5)
      queue.enqueue(makeEntry(1))
      queue.dequeue()
      expect(queue.dequeue()).toBeUndefined()
    })
  })
})
