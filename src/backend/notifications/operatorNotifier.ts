import crypto from 'crypto'
import type { QueueAlert } from '@/backend/actions/queueMonitor'

export interface OperatorAlertPayload {
  event: 'QUEUE_AGE_ALERT' | 'CRITICAL_BACKLOG_ALERT' | 'AUDIT_REPLICATION_FAILURE'
  severity: 'WARN' | 'CRITICAL'
  timestamp: string
  environment: string
  alertCount: number
  alerts?: QueueAlert[]
  auditFailure?: {
    entryId: string
    hash: string
    reason: string
    sinkUrl?: string
  }
}

/**
 * Formats a generic alert payload for Slack incoming webhooks using Block Kit.
 */
export function formatSlackPayload(payload: OperatorAlertPayload) {
  const isCritical = payload.severity === 'CRITICAL'
  const emoji = isCritical ? '🚨' : '⚠️'
  const color = isCritical ? '#E53E3E' : '#DD6B20'

  if (payload.event === 'AUDIT_REPLICATION_FAILURE' && payload.auditFailure) {
    return {
      attachments: [
        {
          color: '#E53E3E',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `🚨 MerchantOS Audit Ledger Replication Failure [CRITICAL]`,
                emoji: true,
              },
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Environment:*\n${payload.environment}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Timestamp:*\n${payload.timestamp}`,
                },
              ],
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Entry ID:*\n\`${payload.auditFailure.entryId}\``,
                },
                {
                  type: 'mrkdwn',
                  text: `*Sink Target:*\n${payload.auditFailure.sinkUrl || 'Local Mirror File'}`,
                },
              ],
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Failure Details:*\n${payload.auditFailure.reason}\n*SHA-256 Hash:* \`${payload.auditFailure.hash}\``,
              },
            },
          ],
        },
      ],
    }
  }

  const alertFields = (payload.alerts || []).map((a) => ({
    type: 'mrkdwn',
    text: `*Queue:* \`${a.queue}\`\n*Age:* ${a.oldestAgeMinutes} min\n*Pending Count:* ${a.count}\n*Details:* ${a.message}`,
  }))

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} MerchantOS Queue Alert [${payload.severity}]`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Environment:*\n${payload.environment}`,
              },
              {
                type: 'mrkdwn',
                text: `*Timestamp:*\n${payload.timestamp}`,
              },
            ],
          },
          ...alertFields.map((field) => ({
            type: 'section',
            fields: [field],
          })),
        ],
      },
    ],
  }
}

/**
 * Formats a generic alert payload for Discord incoming webhooks.
 */
export function formatDiscordPayload(payload: OperatorAlertPayload) {
  const isCritical = payload.severity === 'CRITICAL'
  const color = isCritical ? 0xff0000 : 0xffa500 // Red or Orange

  if (payload.event === 'AUDIT_REPLICATION_FAILURE' && payload.auditFailure) {
    return {
      embeds: [
        {
          title: `🚨 MerchantOS Audit Ledger Replication Failure [CRITICAL]`,
          color: 0xff0000,
          timestamp: payload.timestamp,
          fields: [
            {
              name: 'Entry ID',
              value: `\`${payload.auditFailure.entryId}\``,
              inline: true,
            },
            {
              name: 'Sink Target',
              value: payload.auditFailure.sinkUrl || 'Local Mirror File',
              inline: true,
            },
            {
              name: 'Failure Details',
              value: payload.auditFailure.reason,
              inline: false,
            },
            {
              name: 'SHA-256 Hash',
              value: `\`${payload.auditFailure.hash}\``,
              inline: false,
            },
          ],
          footer: {
            text: `Environment: ${payload.environment} • Severity: CRITICAL`,
          },
        },
      ],
    }
  }

  return {
    embeds: [
      {
        title: `${isCritical ? '🚨' : '⚠️'} MerchantOS Queue Alert [${payload.severity}]`,
        color,
        timestamp: payload.timestamp,
        fields: (payload.alerts || []).map((a) => ({
          name: `Queue: ${a.queue} (${a.severity})`,
          value: `${a.message}\n• **Pending Items:** ${a.count}\n• **Oldest Age:** ${a.oldestAgeMinutes} min`,
          inline: false,
        })),
        footer: {
          text: `Environment: ${payload.environment} • Total Alerts: ${payload.alertCount}`,
        },
      },
    ],
  }
}

/**
 * Dispatches queue alert notifications to configured external operator channels
 * (Generic Webhook, Slack, Discord). Failures are caught and logged, ensuring
 * that alerting issues never interrupt core cron or worker processes.
 */
export async function dispatchOperatorAlert(
  alerts: QueueAlert[],
  options?: {
    webhookUrl?: string
    slackWebhookUrl?: string
    discordWebhookUrl?: string
    alertSecret?: string
    fetchImpl?: typeof fetch
  }
): Promise<{ dispatched: number; failed: number }> {
  if (!alerts || alerts.length === 0) {
    return { dispatched: 0, failed: 0 }
  }

  const webhookUrl = options?.webhookUrl ?? process.env.OPERATOR_ALERT_WEBHOOK_URL
  const slackUrl = options?.slackWebhookUrl ?? process.env.SLACK_WEBHOOK_URL
  const discordUrl = options?.discordWebhookUrl ?? process.env.DISCORD_WEBHOOK_URL
  const secret = options?.alertSecret ?? process.env.ALERT_WEBHOOK_SECRET
  const fetchFn = options?.fetchImpl ?? fetch

  const hasCritical = alerts.some((a) => a.severity === 'CRITICAL')
  const payload: OperatorAlertPayload = {
    event: hasCritical ? 'CRITICAL_BACKLOG_ALERT' : 'QUEUE_AGE_ALERT',
    severity: hasCritical ? 'CRITICAL' : 'WARN',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    alertCount: alerts.length,
    alerts,
  }

  let dispatched = 0
  let failed = 0

  // 1. Generic Webhook with optional HMAC signature
  if (webhookUrl) {
    try {
      const rawBody = JSON.stringify(payload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (secret) {
        const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
        headers['x-operator-alert-signature'] = signature
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const res = await fetchFn(webhookUrl, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        dispatched++
      } else {
        console.error(`[OPERATOR_ALERT:WEBHOOK_FAILED] HTTP ${res.status}`)
        failed++
      }
    } catch (err) {
      console.error('[OPERATOR_ALERT:WEBHOOK_ERROR]', err)
      failed++
    }
  }

  // 2. Slack Webhook
  if (slackUrl) {
    try {
      const slackBody = JSON.stringify(formatSlackPayload(payload))
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const res = await fetchFn(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: slackBody,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        dispatched++
      } else {
        console.error(`[OPERATOR_ALERT:SLACK_FAILED] HTTP ${res.status}`)
        failed++
      }
    } catch (err) {
      console.error('[OPERATOR_ALERT:SLACK_ERROR]', err)
      failed++
    }
  }

  // 3. Discord Webhook
  if (discordUrl) {
    try {
      const discordBody = JSON.stringify(formatDiscordPayload(payload))
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const res = await fetchFn(discordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: discordBody,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        dispatched++
      } else {
        console.error(`[OPERATOR_ALERT:DISCORD_FAILED] HTTP ${res.status}`)
        failed++
      }
    } catch (err) {
      console.error('[OPERATOR_ALERT:DISCORD_ERROR]', err)
      failed++
    }
  }

  return { dispatched, failed }
}

/**
 * Dispatches an immediate high-priority alarm when the audit ledger fails to replicate
 * to an external compliance sink or local append-only mirror.
 */
export async function dispatchAuditReplicationAlert(
  auditFailure: {
    entryId: string
    hash: string
    reason: string
    sinkUrl?: string
  },
  options?: {
    webhookUrl?: string
    slackWebhookUrl?: string
    discordWebhookUrl?: string
    alertSecret?: string
    fetchImpl?: typeof fetch
  }
): Promise<{ dispatched: number; failed: number }> {
  const webhookUrl = options?.webhookUrl ?? process.env.OPERATOR_ALERT_WEBHOOK_URL
  const slackUrl = options?.slackWebhookUrl ?? process.env.SLACK_WEBHOOK_URL
  const discordUrl = options?.discordWebhookUrl ?? process.env.DISCORD_WEBHOOK_URL
  const secret = options?.alertSecret ?? process.env.ALERT_WEBHOOK_SECRET
  const fetchFn = options?.fetchImpl ?? fetch

  const payload: OperatorAlertPayload = {
    event: 'AUDIT_REPLICATION_FAILURE',
    severity: 'CRITICAL',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    alertCount: 1,
    auditFailure,
  }

  let dispatched = 0
  let failed = 0

  // 1. Generic Webhook with HMAC signature
  if (webhookUrl) {
    try {
      const rawBody = JSON.stringify(payload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (secret) {
        const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
        headers['x-operator-alert-signature'] = signature
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const res = await fetchFn(webhookUrl, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        dispatched++
      } else {
        console.error(`[OPERATOR_ALERT:WEBHOOK_FAILED] HTTP ${res.status}`)
        failed++
      }
    } catch (err) {
      console.error('[OPERATOR_ALERT:WEBHOOK_ERROR]', err)
      failed++
    }
  }

  // 2. Slack Webhook
  if (slackUrl) {
    try {
      const slackBody = JSON.stringify(formatSlackPayload(payload))
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const res = await fetchFn(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: slackBody,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        dispatched++
      } else {
        console.error(`[OPERATOR_ALERT:SLACK_FAILED] HTTP ${res.status}`)
        failed++
      }
    } catch (err) {
      console.error('[OPERATOR_ALERT:SLACK_ERROR]', err)
      failed++
    }
  }

  // 3. Discord Webhook
  if (discordUrl) {
    try {
      const discordBody = JSON.stringify(formatDiscordPayload(payload))
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const res = await fetchFn(discordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: discordBody,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        dispatched++
      } else {
        console.error(`[OPERATOR_ALERT:DISCORD_FAILED] HTTP ${res.status}`)
        failed++
      }
    } catch (err) {
      console.error('[OPERATOR_ALERT:DISCORD_ERROR]', err)
      failed++
    }
  }

  return { dispatched, failed }
}
