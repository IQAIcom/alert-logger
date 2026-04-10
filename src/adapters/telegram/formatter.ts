import type { FormattedAlert } from '../../core/types.js'
import { formatDuration } from '../../core/utils.js'

const SEVERITY_EMOJI: Record<string, string> = {
  info: '\ud83d\udd35',
  warning: '\u26a0\ufe0f',
  critical: '\ud83d\udd34',
}

const RESOLUTION_EMOJI = '\u2705'
const MAX_MESSAGE_LENGTH = 4096

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

export function formatTelegramMessage(alert: FormattedAlert): string {
  const { aggregation } = alert
  const phase = aggregation.phase

  const safeTitle = escapeHtml(alert.title)
  const safeMessage = escapeHtml(alert.message)
  const badge = escapeHtml(alert.environmentBadge)
  const parts: string[] = []

  switch (phase) {
    case 'onset': {
      const emoji = SEVERITY_EMOJI[alert.level] ?? SEVERITY_EMOJI.info
      parts.push(`${emoji} <b>${badge} [${alert.level.toUpperCase()}] ${safeTitle}</b>`)
      parts.push('', safeMessage)

      if (alert.error?.stack) {
        parts.push('', `<code>${escapeHtml(alert.error.stack)}</code>`)
      }

      if (alert.options.fields) {
        parts.push('')
        for (const [key, value] of Object.entries(alert.options.fields)) {
          parts.push(`<b>${escapeHtml(key)}:</b> ${escapeHtml(String(value))}`)
        }
      }
      break
    }

    case 'ramp': {
      const emoji = SEVERITY_EMOJI[alert.level] ?? SEVERITY_EMOJI.info
      parts.push(
        `${emoji} <b>${badge} [${alert.level.toUpperCase()}] ${safeTitle} (x${aggregation.count} \u2014 ${aggregation.suppressedSince} suppressed since last)</b>`,
      )
      parts.push('', safeMessage)
      break
    }

    case 'sustained': {
      const emoji = SEVERITY_EMOJI[alert.level] ?? SEVERITY_EMOJI.info
      parts.push(
        `${emoji} <b>${badge} [${alert.level.toUpperCase()}] ${safeTitle} (x${aggregation.count} \u00B7 peak: ${aggregation.peakRate.toFixed(1)}/s)</b>`,
      )
      parts.push('', safeMessage)
      break
    }

    case 'resolution': {
      const totalDuration = formatDuration(aggregation.lastSeen - aggregation.firstSeen)
      parts.push(
        `${RESOLUTION_EMOJI} <b>Resolved: ${safeTitle} \u2014 ${aggregation.count} total over ${totalDuration}</b>`,
      )
      break
    }
  }

  parts.push(
    '',
    `<i>Service: ${escapeHtml(alert.serviceName)} | ${new Date(alert.timestamp).toISOString()}</i>`,
  )

  return truncate(parts.join('\n'), MAX_MESSAGE_LENGTH)
}
