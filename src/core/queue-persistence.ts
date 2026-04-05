import { writeFile, rename, readFile } from 'node:fs/promises'
import type { QueueEntry } from './retry-queue.js'

interface SerializedQueues {
  [adapterName: string]: QueueEntry[]
}

export async function saveQueuesToDisk(
  path: string,
  queues: Map<string, QueueEntry[]>,
): Promise<void> {
  const obj: SerializedQueues = {}
  for (const [name, entries] of queues) {
    obj[name] = entries
  }

  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(obj), 'utf-8')
  await rename(tmp, path)
}

export async function loadQueuesFromDisk(
  path: string,
): Promise<Map<string, QueueEntry[]>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map()
    }
    throw err
  }

  try {
    const obj = JSON.parse(raw) as SerializedQueues
    const map = new Map<string, QueueEntry[]>()
    for (const [name, entries] of Object.entries(obj)) {
      map.set(name, entries)
    }
    return map
  } catch {
    console.warn(`[alert-logger] Failed to parse queue persistence file at ${path}, starting with empty queues`)
    return new Map()
  }
}
