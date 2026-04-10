import type { AlertAdapter, AlertLevel, FormattedAlert } from '../../core/types.js'
import { formatSlackPayload } from './formatter.js'

export interface SlackAdapterOptions {
  webhookUrl: string
  channels?: Partial<Record<AlertLevel, string>>
  tags?: Record<string, string>
  mentions?: Partial<Record<AlertLevel, string[]>>
}

export class SlackAdapter implements AlertAdapter {
  readonly name = 'slack' as const
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  private readonly webhookUrl: string
  private readonly channels: Partial<Record<AlertLevel, string>>
  private readonly tags: Record<string, string>
  private readonly mentions: Partial<Record<AlertLevel, string[]>>

  constructor(options: SlackAdapterOptions) {
    this.webhookUrl = options.webhookUrl
    this.channels = options.channels ?? {}
    this.tags = options.tags ?? {}
    this.mentions = options.mentions ?? {}
  }

  rateLimits() {
    return { maxPerWindow: 1, windowMs: 1_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    const payload = formatSlackPayload(alert)
    const { url, mentions } = this.resolve(alert.level, alert.options.tags)

    const body: Record<string, unknown> = { ...payload }

    if (mentions.length > 0) {
      body.text = mentions.join(' ')
    }

    await this.postWebhook(url, body)
  }

  async healthy(): Promise<boolean> {
    return true
  }

  private resolve(level: AlertLevel, tags?: string[]): { url: string; mentions: string[] } {
    const mentions = this.mentions[level] ?? []

    if (tags?.length) {
      for (const tag of tags) {
        const url = this.tags[tag]
        if (url) return { url, mentions }
      }
    }

    const levelUrl = this.channels[level]
    if (levelUrl) return { url: levelUrl, mentions }

    return { url: this.webhookUrl, mentions }
  }

  private async postWebhook(
    url: string,
    body: Record<string, unknown>,
    retryCount = 0,
  ): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (response.status === 429 && retryCount < 2) {
      const retryAfter = Number(response.headers.get('Retry-After')) || 1
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      return this.postWebhook(url, body, retryCount + 1)
    }

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}: ${await response.text()}`)
    }
  }
}
