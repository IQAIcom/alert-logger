import { createHash } from 'node:crypto'
import type { FingerprintConfig, NormalizerRule } from './types.js'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const HEX_RE = /0x[a-fA-F0-9]{6,}/g
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g
const NUMBER_RE = /\b\d+\b/g

const BUILTIN_NORMALIZERS: NormalizerRule[] = [
  { pattern: UUID_RE, replacement: '<uuid>' },
  { pattern: HEX_RE, replacement: '<hex>' },
  { pattern: ISO_TIMESTAMP_RE, replacement: '<timestamp>' },
  { pattern: NUMBER_RE, replacement: '<num>' },
]

function normalizeMessage(message: string, userNormalizers: NormalizerRule[]): string {
  let result = message

  // Apply user-defined normalizers first
  for (const rule of userNormalizers) {
    result = result.replace(rule.pattern, rule.replacement)
  }

  // Then apply built-in normalizers
  for (const rule of BUILTIN_NORMALIZERS) {
    result = result.replace(rule.pattern, rule.replacement)
  }

  return result
}

const NODE_MODULES_RE = /node_modules/
const FRAME_RE = /\((.+):(\d+):(\d+)\)|at (.+):(\d+):(\d+)/

function extractStackKey(error: Error | undefined, depth: number): string {
  if (!error?.stack) return ''

  const lines = error.stack.split('\n')
  const frames: string[] = []

  for (const line of lines) {
    if (frames.length >= depth) break
    if (NODE_MODULES_RE.test(line)) continue

    const match = FRAME_RE.exec(line)
    if (!match) continue

    const file = match[1] ?? match[4]
    const lineNum = match[2] ?? match[5]
    const col = match[3] ?? match[6]
    frames.push(`${file}:${lineNum}:${col}`)
  }

  return frames.join('|')
}

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex')
}

export function fingerprint(
  title: string,
  message: string,
  error: Error | undefined,
  config: FingerprintConfig,
  dedupKey?: string,
): string {
  if (dedupKey) {
    return md5(dedupKey)
  }

  const normalizedTitle = normalizeMessage(title, config.normalizers)
  const normalizedMessage = normalizeMessage(message, config.normalizers)
  const stackKey = extractStackKey(error, config.stackDepth)
  const errorName = error?.name ?? normalizedTitle

  return md5(errorName + normalizedMessage + stackKey)
}
