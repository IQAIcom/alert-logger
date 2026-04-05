import type { FormattedAlert } from '../../core/types.js'

export interface DiscordEmbed {
  title: string
  description?: string
  color: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}

const SEVERITY_COLORS: Record<string, number> = {
  info: 0x3498db,
  warning: 0xf39c12,
  critical: 0xe74c3c,
}

const RESOLUTION_COLOR = 0x2ecc71

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

/**
 * Sanitize text to prevent Discord mention injection.
 */
function sanitize(text: string): string {
  return text
    .replace(/@everyone/gi, '@\u200Beveryone')
    .replace(/@here/gi, '@\u200Bhere')
    .replace(/<@[!&]?\d+>/g, '[mention]')
    .replace(/<#\d+>/g, '[channel]')
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export function formatDiscordEmbed(alert: FormattedAlert): DiscordEmbed {
  const { aggregation } = alert
  const phase = aggregation.phase

  const color =
    phase === 'resolution'
      ? RESOLUTION_COLOR
      : (SEVERITY_COLORS[alert.level] ?? SEVERITY_COLORS.info)

  const safeTitle = sanitize(alert.title)
  const safeMessage = sanitize(alert.message)
  const badge = alert.environmentBadge

  switch (phase) {
    case 'onset': {
      const title = truncate(`${badge} [${alert.level.toUpperCase()}] ${safeTitle}`, 256)

      let description = safeMessage
      if (alert.error?.stack) {
        description += `\n\n\`\`\`\n${sanitize(alert.error.stack)}\n\`\`\``
      }
      description = truncate(description, 2000)

      const fields: Array<{ name: string; value: string; inline?: boolean }> = []
      if (alert.options.fields) {
        for (const [key, value] of Object.entries(alert.options.fields)) {
          fields.push({
            name: truncate(sanitize(key), 256),
            value: truncate(sanitize(String(value)), 1024),
            inline: true,
          })
        }
      }

      return {
        title,
        description,
        color,
        fields: fields.length > 0 ? fields : undefined,
        footer: { text: `Service: ${alert.serviceName}` },
        timestamp: new Date(alert.timestamp).toISOString(),
      }
    }

    case 'ramp': {
      const title = truncate(
        `${badge} [${alert.level.toUpperCase()}] ${safeTitle} (x${aggregation.count} \u2014 ${aggregation.suppressedSince} suppressed since last)`,
        256,
      )

      return {
        title,
        description: truncate(safeMessage, 2000),
        color,
        footer: { text: `Service: ${alert.serviceName}` },
        timestamp: new Date(alert.timestamp).toISOString(),
      }
    }

    case 'sustained': {
      const title = truncate(
        `${badge} [${alert.level.toUpperCase()}] ${safeTitle} (x${aggregation.count} in last digest period \u00B7 peak rate: ${aggregation.peakRate.toFixed(1)}/s)`,
        256,
      )

      return {
        title,
        description: truncate(safeMessage, 2000),
        color,
        footer: { text: `Service: ${alert.serviceName}` },
        timestamp: new Date(alert.timestamp).toISOString(),
      }
    }

    case 'resolution': {
      const totalDuration = formatDuration(aggregation.lastSeen - aggregation.firstSeen)
      const title = truncate(
        `\u2705 Resolved: ${safeTitle} \u2014 ${aggregation.count} total over ${totalDuration}`,
        256,
      )

      return {
        title,
        color,
        footer: { text: `Service: ${alert.serviceName}` },
        timestamp: new Date(alert.timestamp).toISOString(),
      }
    }
  }
}
