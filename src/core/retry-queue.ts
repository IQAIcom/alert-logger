import type { FormattedAlert } from './types.js'

export interface QueueEntry {
  alert: FormattedAlert
  enqueuedAt: number
  retryCount: number
}

export class RetryQueue {
  private buffer: (QueueEntry | undefined)[]
  private head: number
  private tail: number
  private count: number
  private readonly maxSize: number

  constructor(maxSize: number) {
    if (maxSize < 1) throw new Error('RetryQueue maxSize must be at least 1')
    this.maxSize = maxSize
    this.buffer = new Array<QueueEntry | undefined>(maxSize)
    this.head = 0
    this.tail = 0
    this.count = 0
  }

  enqueue(entry: QueueEntry): void {
    this.buffer[this.tail] = entry
    this.tail = (this.tail + 1) % this.maxSize

    if (this.count === this.maxSize) {
      // Buffer is full — oldest entry is overwritten, advance head
      this.head = (this.head + 1) % this.maxSize
    } else {
      this.count++
    }
  }

  dequeue(): QueueEntry | undefined {
    if (this.count === 0) return undefined

    const entry = this.buffer[this.head]
    this.buffer[this.head] = undefined
    this.head = (this.head + 1) % this.maxSize
    this.count--
    return entry
  }

  peek(): QueueEntry | undefined {
    if (this.count === 0) return undefined
    return this.buffer[this.head]
  }

  drain(): QueueEntry[] {
    const entries: QueueEntry[] = []
    while (this.count > 0) {
      entries.push(this.dequeue()!)
    }
    return entries
  }

  get size(): number {
    return this.count
  }

  get isEmpty(): boolean {
    return this.count === 0
  }

  get isFull(): boolean {
    return this.count === this.maxSize
  }

  toJSON(): QueueEntry[] {
    const entries: QueueEntry[] = []
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.maxSize
      entries.push(this.buffer[idx]!)
    }
    return entries
  }

  static fromEntries(entries: QueueEntry[], maxSize: number): RetryQueue {
    const queue = new RetryQueue(maxSize)
    for (const entry of entries) {
      queue.enqueue(entry)
    }
    return queue
  }
}
