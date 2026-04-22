import { fingerprint } from './fingerprinter.js'
import type { FingerprintConfig } from './types.js'
import { DEFAULT_FINGERPRINT } from './types.js'

const cfg = DEFAULT_FINGERPRINT

describe('fingerprint', () => {
  // ── Normalization patterns ──────────────────────────────────────────

  describe('normalization', () => {
    it('strips UUIDs from messages', () => {
      const a = fingerprint('E', 'user 550e8400-e29b-41d4-a716-446655440000 failed', undefined, cfg)
      const b = fingerprint('E', 'user d4f5a8c3-1b2e-4f6a-9c8d-0e1f2a3b4c5d failed', undefined, cfg)
      expect(a).toBe(b)
    })

    it('strips hex addresses from messages', () => {
      const a = fingerprint('E', 'segfault at 0xDEADBEEF', undefined, cfg)
      const b = fingerprint('E', 'segfault at 0x1234ABCD', undefined, cfg)
      expect(a).toBe(b)
    })

    it('strips ISO timestamps from messages', () => {
      const a = fingerprint('E', 'error at 2024-01-15T10:30:00Z', undefined, cfg)
      const b = fingerprint('E', 'error at 2025-12-01T23:59:59.999+05:30', undefined, cfg)
      expect(a).toBe(b)
    })

    it('strips numbers from messages', () => {
      const a = fingerprint('E', 'timeout after 3000 ms', undefined, cfg)
      const b = fingerprint('E', 'timeout after 5000 ms', undefined, cfg)
      expect(a).toBe(b)
    })

    it('strips numbers adjacent to unit letters (e.g. 330s, 120ms)', () => {
      const a = fingerprint('E', 'No block processed for 330s (threshold: 120s)', undefined, cfg)
      const b = fingerprint('E', 'No block processed for 360s (threshold: 120s)', undefined, cfg)
      expect(a).toBe(b)
    })

    it('strips multiple patterns in one message', () => {
      const a = fingerprint(
        'E',
        'req 550e8400-e29b-41d4-a716-446655440000 failed at 2024-01-01T00:00:00Z with code 500',
        undefined,
        cfg,
      )
      const b = fingerprint(
        'E',
        'req d4f5a8c3-1b2e-4f6a-9c8d-0e1f2a3b4c5d failed at 2025-06-15T12:00:00Z with code 502',
        undefined,
        cfg,
      )
      expect(a).toBe(b)
    })
  })

  // ── Hash stability ──────────────────────────────────────────────────

  describe('hash stability', () => {
    it('returns the same hash for identical inputs', () => {
      const a = fingerprint('Err', 'something broke', undefined, cfg)
      const b = fingerprint('Err', 'something broke', undefined, cfg)
      expect(a).toBe(b)
    })

    it('returns a 32-character hex string (md5)', () => {
      const hash = fingerprint('E', 'msg', undefined, cfg)
      expect(hash).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  // ── Different errors → different hashes ─────────────────────────────

  describe('distinct errors', () => {
    it('produces different hashes for different messages', () => {
      const a = fingerprint('E', 'connection refused', undefined, cfg)
      const b = fingerprint('E', 'connection timeout', undefined, cfg)
      expect(a).not.toBe(b)
    })

    it('produces different hashes for different titles when no error', () => {
      const a = fingerprint('TypeError', 'x is not a function', undefined, cfg)
      const b = fingerprint('RangeError', 'x is not a function', undefined, cfg)
      expect(a).not.toBe(b)
    })

    it('uses error.name instead of title when error is present', () => {
      const err = new TypeError('boom')
      const a = fingerprint('ignored-title', 'boom', err, cfg)
      const b = fingerprint('different-title', 'boom', err, cfg)
      expect(a).toBe(b)
    })
  })

  // ── Custom dedupKey ─────────────────────────────────────────────────

  describe('dedupKey', () => {
    it('bypasses fingerprinting when dedupKey is provided', () => {
      const a = fingerprint('E', 'msg one', undefined, cfg, 'my-key')
      const b = fingerprint('E', 'msg two', undefined, cfg, 'my-key')
      expect(a).toBe(b)
    })

    it('different dedupKeys produce different hashes', () => {
      const a = fingerprint('E', 'msg', undefined, cfg, 'key-a')
      const b = fingerprint('E', 'msg', undefined, cfg, 'key-b')
      expect(a).not.toBe(b)
    })

    it('returns md5 of the dedupKey', () => {
      const hash = fingerprint('E', 'msg', undefined, cfg, 'stable')
      // same call, same result
      expect(hash).toBe(fingerprint('X', 'other', undefined, cfg, 'stable'))
    })
  })

  // ── Custom normalizers ──────────────────────────────────────────────

  describe('custom normalizers', () => {
    it('applies user-defined normalizers on top of builtins', () => {
      const custom: FingerprintConfig = {
        stackDepth: 3,
        normalizers: [{ pattern: /order-\w+/g, replacement: '<order>' }],
      }
      const a = fingerprint('E', 'failed order-abc123', undefined, custom)
      const b = fingerprint('E', 'failed order-xyz789', undefined, custom)
      expect(a).toBe(b)
    })

    it('does not let broad user rules break built-in UUID normalization', () => {
      // A user-supplied `/\d+/g` rule used to run before built-ins and strip
      // digits out of UUIDs, leaving distinct strings where a UUID should
      // have collapsed to "<uuid>". Built-ins now run first, so structural
      // identifiers survive.
      const custom: FingerprintConfig = {
        stackDepth: 3,
        normalizers: [{ pattern: /\d+/g, replacement: '<num>' }],
      }
      const a = fingerprint(
        'E',
        'Trade a51c80e4-3307-4d5f-a035-03c8fd1f767d permanently failed',
        undefined,
        custom,
      )
      const b = fingerprint(
        'E',
        'Trade 1bbc368f-a1fa-44af-9d04-ffaa804a30b1 permanently failed',
        undefined,
        custom,
      )
      expect(a).toBe(b)
    })

    it('does not let broad user rules break built-in hex normalization', () => {
      const custom: FingerprintConfig = {
        stackDepth: 3,
        normalizers: [{ pattern: /\d+/g, replacement: '<num>' }],
      }
      const a = fingerprint(
        'E',
        'safeTxHash=0x9db6e277fdea4e17ef1597e358d7bd893d257cf62378180a9d279fdeb1d0ab58',
        undefined,
        custom,
      )
      const b = fingerprint(
        'E',
        'safeTxHash=0xf51b9f89c5919f9efffd9eb2450251bf668ec8410aa5c599c267027fc92b8466',
        undefined,
        custom,
      )
      expect(a).toBe(b)
    })
  })

  // ── Stack frame extraction ──────────────────────────────────────────

  describe('stack frame extraction', () => {
    function makeErrorWithStack(stack: string): Error {
      const err = new Error('test')
      err.stack = stack
      return err
    }

    it('filters out node_modules frames', () => {
      const stack = [
        'Error: test',
        '    at myFunc (/app/src/index.ts:10:5)',
        '    at Object.<anonymous> (/app/node_modules/lib/index.js:3:1)',
        '    at anotherFunc (/app/src/util.ts:20:3)',
      ].join('\n')

      const errA = makeErrorWithStack(stack)

      // Same app frames, different node_modules path
      const stack2 = [
        'Error: test',
        '    at myFunc (/app/src/index.ts:10:5)',
        '    at Object.<anonymous> (/app/node_modules/other-lib/dist/index.js:99:1)',
        '    at anotherFunc (/app/src/util.ts:20:3)',
      ].join('\n')

      const errB = makeErrorWithStack(stack2)

      const a = fingerprint('E', 'test', errA, cfg)
      const b = fingerprint('E', 'test', errB, cfg)
      expect(a).toBe(b)
    })

    it('respects configurable stack depth', () => {
      const stack = [
        'Error: test',
        '    at first (/app/src/a.ts:1:1)',
        '    at second (/app/src/b.ts:2:2)',
        '    at third (/app/src/c.ts:3:3)',
      ].join('\n')

      const err = makeErrorWithStack(stack)

      const shallow: FingerprintConfig = { stackDepth: 1, normalizers: [] }
      const deep: FingerprintConfig = { stackDepth: 3, normalizers: [] }

      const a = fingerprint('E', 'test', err, shallow)
      const b = fingerprint('E', 'test', err, deep)
      expect(a).not.toBe(b)
    })

    it('groups same error from different callers with default stackDepth', () => {
      const stackA = [
        'Error: test',
        '    at throwSite (/app/src/shared.ts:10:5)',
        '    at callerA (/app/src/a.ts:20:3)',
        '    at handlerA (/app/src/routes-a.ts:30:1)',
      ].join('\n')
      const stackB = [
        'Error: test',
        '    at throwSite (/app/src/shared.ts:10:5)',
        '    at callerB (/app/src/b.ts:40:3)',
        '    at handlerB (/app/src/routes-b.ts:50:1)',
      ].join('\n')

      const a = fingerprint('E', 'test', makeErrorWithStack(stackA), cfg)
      const b = fingerprint('E', 'test', makeErrorWithStack(stackB), cfg)
      expect(a).toBe(b)
    })

    it('includes file, line, and column in stack key', () => {
      const stackA = ['Error: test', '    at fn (/app/src/index.ts:10:5)'].join('\n')
      const stackB = ['Error: test', '    at fn (/app/src/index.ts:10:99)'].join('\n')

      const a = fingerprint('E', 'test', makeErrorWithStack(stackA), cfg)
      const b = fingerprint('E', 'test', makeErrorWithStack(stackB), cfg)
      expect(a).not.toBe(b)
    })
  })

  // ── Missing error ───────────────────────────────────────────────────

  describe('missing error', () => {
    it('works when error is undefined', () => {
      const hash = fingerprint('Alert', 'disk full', undefined, cfg)
      expect(hash).toMatch(/^[0-9a-f]{32}$/)
    })

    it('uses normalized title as errorName when error is undefined', () => {
      const a = fingerprint('TitleA', 'same msg', undefined, cfg)
      const b = fingerprint('TitleB', 'same msg', undefined, cfg)
      expect(a).not.toBe(b)
    })

    it('normalizes dynamic parts in title when error is undefined', () => {
      const a = fingerprint('GET /users/0xABC123DEF/positions', 'table missing', undefined, cfg)
      const b = fingerprint('GET /users/0xDEF456ABC/positions', 'table missing', undefined, cfg)
      expect(a).toBe(b)
    })
  })
})
