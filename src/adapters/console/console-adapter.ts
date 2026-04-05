import type { AlertAdapter, AlertLevel, FormattedAlert } from '../../core/types.js'

export interface ConsoleAdapterOptions {
  pretty?: boolean
}

const LEVEL_COLORS: Record<AlertLevel, string> = {
  info: '\x1b[34m',
  warning: '\x1b[33m',
  critical: '\x1b[31m',
}

const RESOLUTION_COLOR = '\x1b[32m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

export class ConsoleAdapter implements AlertAdapter {
  readonly name = 'console' as const
  levels: AlertLevel[] = ['info', 'warning', 'critical']

  private readonly pretty: boolean

  constructor(options?: ConsoleAdapterOptions) {
    this.pretty = options?.pretty ?? process.stdout.isTTY ?? false
  }

  rateLimits() {
    return { maxPerWindow: 1000, windowMs: 60_000 }
  }

  async send(alert: FormattedAlert): Promise<void> {
    const output = this.pretty ? this.formatPretty(alert) : this.formatJson(alert)

    process.stdout.write(`${output}\n`)
  }

  private formatPretty(alert: FormattedAlert): string {
    const { aggregation } = alert
    const isResolution = aggregation.phase === 'resolution'
    const color = isResolution ? RESOLUTION_COLOR : LEVEL_COLORS[alert.level]
    const ts = new Date(alert.timestamp).toISOString()
    const levelTag = alert.level.toUpperCase()

    const lines: string[] = []

    lines.push(
      `${color}${BOLD}[${ts}] [${levelTag}] ${alert.environmentBadge} ${alert.title}${RESET}`,
    )
    lines.push(`  ${alert.message}`)

    const fields = alert.options.fields
    if (fields && Object.keys(fields).length > 0) {
      const pairs = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      lines.push(`  fields: ${pairs}`)
    }

    lines.push(`  count: ${aggregation.count} | phase: ${aggregation.phase}`)

    return lines.join('\n')
  }

  private formatJson(alert: FormattedAlert): string {
    return JSON.stringify({
      timestamp: new Date(alert.timestamp).toISOString(),
      level: alert.level,
      badge: alert.environmentBadge,
      title: alert.title,
      message: alert.message,
      fields: alert.options.fields ?? {},
      aggregation: {
        phase: alert.aggregation.phase,
        count: alert.aggregation.count,
      },
    })
  }
}
