import type { AlertAdapter, AlertLevel, FormattedAlert } from '../../core/types.js'
import { formatDiscordEmbed } from './formatter.js'

export interface DiscordAdapterOptions {
  webhookUrl: string
}

export class DiscordAdapter implements AlertAdapter {
  readonly name = 'discord' as const
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  private readonly webhookUrl: string

  constructor(options: DiscordAdapterOptions) {
    this.webhookUrl = options.webhookUrl
  }

  rateLimits() {
    return { maxPerWindow: 30, windowMs: 60_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    const embed = formatDiscordEmbed(alert)
    const webhookUrl = alert.webhookUrl ?? this.webhookUrl

    const payload: Record<string, unknown> = { embeds: [embed] }

    if (alert.pings.length > 0) {
      payload.content = alert.pings.join(' ')
    }

    await this.postWebhook(webhookUrl, payload)
  }

  async healthy(): Promise<boolean> {
    return true
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
      throw new Error(
        `Discord webhook returned ${response.status}: ${await response.text()}`,
      )
    }
  }
}
