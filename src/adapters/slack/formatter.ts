import type { FormattedAlert } from '../../core/types.js'
import { formatDuration } from '../../core/utils.js'

export interface SlackBlock {
	type: string
	text?: { type: string; text: string }
	fields?: Array<{ type: string; text: string }>
	elements?: Array<{ type: string; text: string }>
}

export interface SlackAttachment {
	color: string
	blocks: SlackBlock[]
}

export interface SlackPayload {
	attachments: SlackAttachment[]
}

const SEVERITY_COLORS: Record<string, string> = {
	info: '#3498db',
	warning: '#f39c12',
	critical: '#e74c3c',
}

const RESOLUTION_COLOR = '#2ecc71'

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

export function formatSlackPayload(alert: FormattedAlert): SlackPayload {
	const { aggregation } = alert
	const phase = aggregation.phase

	const color =
		phase === 'resolution'
			? RESOLUTION_COLOR
			: (SEVERITY_COLORS[alert.level] ?? SEVERITY_COLORS.info)

	const badge = alert.environmentBadge
	const blocks: SlackBlock[] = []

	switch (phase) {
		case 'onset': {
			const title = truncate(`${badge} [${alert.level.toUpperCase()}] ${alert.title}`, 150)

			let body = alert.message
			if (alert.error?.stack) {
				body += `\n\n\`\`\`\n${alert.error.stack}\n\`\`\``
			}
			body = truncate(body, 3000)

			blocks.push(
				{
					type: 'header',
					text: { type: 'plain_text', text: title },
				},
				{
					type: 'section',
					text: { type: 'mrkdwn', text: body },
				},
			)

			if (alert.options.fields) {
				const fields = Object.entries(alert.options.fields).map(([key, value]) => ({
					type: 'mrkdwn' as const,
					text: `*${key}:* ${String(value)}`,
				}))
				blocks.push({ type: 'section', fields })
			}
			break
		}

		case 'ramp': {
			const title = truncate(
				`${badge} [${alert.level.toUpperCase()}] ${alert.title} (x${aggregation.count} \u2014 ${aggregation.suppressedSince} suppressed since last)`,
				150,
			)

			blocks.push(
				{
					type: 'header',
					text: { type: 'plain_text', text: title },
				},
				{
					type: 'section',
					text: { type: 'mrkdwn', text: truncate(alert.message, 3000) },
				},
			)
			break
		}

		case 'sustained': {
			const title = truncate(
				`${badge} [${alert.level.toUpperCase()}] ${alert.title} (x${aggregation.count} \u00B7 peak: ${aggregation.peakRate.toFixed(1)}/s)`,
				150,
			)

			blocks.push(
				{
					type: 'header',
					text: { type: 'plain_text', text: title },
				},
				{
					type: 'section',
					text: { type: 'mrkdwn', text: truncate(alert.message, 3000) },
				},
			)
			break
		}

		case 'resolution': {
			const totalDuration = formatDuration(aggregation.lastSeen - aggregation.firstSeen)
			const title = truncate(
				`\u2705 Resolved: ${alert.title} \u2014 ${aggregation.count} total over ${totalDuration}`,
				150,
			)

			blocks.push({
				type: 'header',
				text: { type: 'plain_text', text: title },
			})
			break
		}
	}

	blocks.push({
		type: 'context',
		elements: [
			{
				type: 'mrkdwn',
				text: `Service: ${alert.serviceName} | ${new Date(alert.timestamp).toISOString()}`,
			},
		],
	})

	return { attachments: [{ color, blocks }] }
}
