import type { AlertAdapter, AlertLevel, FormattedAlert } from '../../core/types.js'
import { formatTelegramMessage } from './formatter.js'

export interface TelegramAdapterOptions {
  botToken: string
  chatId: string
  topics?: Partial<Record<AlertLevel, number>>
  tags?: Record<string, number>
  mentions?: Partial<Record<AlertLevel, string[]>>
}

export class TelegramAdapter implements AlertAdapter {
  readonly name = 'telegram' as const
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  private readonly botToken: string
  private readonly chatId: string
  private readonly topics: Partial<Record<AlertLevel, number>>
  private readonly tags: Record<string, number>
  private readonly mentions: Partial<Record<AlertLevel, string[]>>

  constructor(options: TelegramAdapterOptions) {
    this.botToken = options.botToken
    this.chatId = options.chatId
    this.topics = options.topics ?? {}
    this.tags = options.tags ?? {}
    this.mentions = options.mentions ?? {}
  }

  rateLimits() {
    return { maxPerWindow: 20, windowMs: 60_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    let text = formatTelegramMessage(alert)
    const { topicId, mentions } = this.resolve(alert.level, alert.options.tags)

    if (mentions.length > 0) {
      text = `${mentions.join(' ')}\n\n${text}`
    }

    const body: Record<string, unknown> = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
    }

    if (topicId !== undefined) {
      body.message_thread_id = topicId
    }

    await this.postApi(body)
  }

  async healthy(): Promise<boolean> {
    return true
  }

  private resolve(level: AlertLevel, tags?: string[]): { topicId?: number; mentions: string[] } {
    const mentions = this.mentions[level] ?? []

    if (tags?.length) {
      for (const tag of tags) {
        const topicId = this.tags[tag]
        if (topicId !== undefined) return { topicId, mentions }
      }
    }

    const topicId = this.topics[level]
    if (topicId !== undefined) return { topicId, mentions }

    return { mentions }
  }

  private async postApi(body: Record<string, unknown>, retryCount = 0): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (response.status === 429 && retryCount < 2) {
      const json = (await response.json()) as { parameters?: { retry_after?: number } }
      const retryAfter = json.parameters?.retry_after ?? 1
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      return this.postApi(body, retryCount + 1)
    }

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { description?: string }
      const description = json.description ?? `status ${response.status}`
      throw new Error(`Telegram API error: ${description}`)
    }
  }
}
