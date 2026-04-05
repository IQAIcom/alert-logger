import type { AlertLevel, RoutingConfig } from './types.js'

export class Router {
  private routing: RoutingConfig
  private pings: Partial<Record<AlertLevel, string[]>>

  constructor(routing: RoutingConfig, pings: Partial<Record<AlertLevel, string[]>>) {
    this.routing = routing
    this.pings = pings
  }

  route(level: AlertLevel, tags?: string[]): { webhookUrl?: string; pings: string[] } {
    const webhookUrl = this.resolveWebhookUrl(level, tags)
    const pings = this.pings[level] ?? []

    return webhookUrl ? { webhookUrl, pings } : { pings }
  }

  private resolveWebhookUrl(level: AlertLevel, tags?: string[]): string | undefined {
    // 1. Tag match
    if (tags?.length && this.routing.tags) {
      for (const tag of tags) {
        const url = this.routing.tags[tag]
        if (url) return url
      }
    }

    // 2. Level match
    if (this.routing.channels?.[level]) {
      return this.routing.channels[level]
    }

    // 3. No override — adapter uses its default
    return undefined
  }
}
