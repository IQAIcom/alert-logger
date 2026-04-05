# Phase 3: Reliability — Implementation Plan

## Design Decisions (from brainstorming)

- **Ring buffer per adapter** — overwrites oldest entries; newer alerts are more actionable
- **Per-adapter queues** — adapters fail independently; Discord down shouldn't affect Console
- **Retry**: 3 max retries, exponential backoff (10s → 30s → 90s), 1hr max age before drop
- **Disk persistence**: atomic JSON rewrite (write tmp → rename) — simple, crash-safe
- **Drain order**: FIFO (preserves causal ordering)
- **Health tracking**: per-adapter-instance, not per-URL
- **Unhealthy detection**: 3 consecutive failures AND 30s since last success
- **Recovery**: optimistic retry on 10s drain timer; success = recovered
- **Architecture**: separate HealthManager class wrapping adapter dispatch

## Tasks

### 3.1 RetryQueue class (`src/core/retry-queue.ts`)
- Ring buffer implementation with configurable maxSize
- `enqueue(item: QueueEntry)` — adds to buffer, overwrites oldest if full
- `dequeue(): QueueEntry | undefined` — FIFO removal
- `peek(): QueueEntry | undefined` — view oldest without removing
- `size`, `isEmpty`, `isFull` getters
- `QueueEntry`: `{ alert: FormattedAlert, enqueuedAt: number, retryCount: number }`
- `toJSON()` / `static fromJSON()` for disk persistence
- Tests: enqueue/dequeue, ring buffer overflow, serialization

### 3.2 HealthManager class (`src/core/health-manager.ts`)
- Per-adapter health state: `{ consecutiveFailures, lastSuccessAt, warnedAt, queue: RetryQueue, draining }`
- `dispatch(adapter, alert)` — main entry point:
  - If healthy → try `adapter.send()`, update health on success/failure
  - If unhealthy → enqueue, emit one console warning (suppress further)
- `isHealthy(adapter)`: `consecutiveFailures < 3 || timeSinceLastSuccess <= 30_000`
- Drain timer (10s, unref'd): attempt to send oldest queued item
  - Success → mark recovered, emit recovery summary, flush rest
  - Failure → keep unhealthy, no re-warn
- Recovery summary: synthetic FormattedAlert with stats (count, downtime duration)
- `destroy()` — clear all drain timers
- Tests: health transitions, queue dispatch, recovery flow, warning suppression

### 3.3 Disk persistence (`src/core/queue-persistence.ts`)
- `saveToDisk(path, queues: Map<string, RetryQueue>)` — atomic write (tmp + rename)
- `loadFromDisk(path): Map<string, QueueEntry[]>` — parse JSON, handle corrupt/missing
- Called on `HealthManager.destroy()` (save) and constructor (load)
- Only if `config.queue.persistPath` is set
- Tests: save/load roundtrip, missing file, corrupt file

### 3.4 Integration with AlertLogger
- Replace direct `adapter.send()` calls with `healthManager.dispatch()`
- Wire `healthManager.destroy()` into `AlertLogger.destroy()`
- Pass queue config to HealthManager constructor
- Tests: end-to-end with failing mock adapter

### 3.5 Verification
- All existing tests still pass
- New tests cover retry queue, health manager, persistence
- Build succeeds
