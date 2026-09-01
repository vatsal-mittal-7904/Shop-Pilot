import { describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'
import {
  dispatchOperatorAlert,
  formatDiscordPayload,
  formatSlackPayload,
  OperatorAlertPayload,
} from '@/backend/notifications/operatorNotifier'
import type { QueueAlert } from '@/backend/actions/queueMonitor'

describe('Operator Notifier & Alerting Channels', () => {
  const sampleAlerts: QueueAlert[] = [
    {
      queue: 'REFUND',
      severity: 'CRITICAL',
      message: 'Critical refund queue backlog: 2 pending refund(s), oldest is 35 minutes old.',
      oldestAgeMinutes: 35,
      count: 2,
    },
    {
      queue: 'PAYMENT_RECONCILIATION',
      severity: 'WARN',
      message: 'Warning: 1 pending reconciliation(s), oldest is 18 minutes old.',
      oldestAgeMinutes: 18,
      count: 1,
    },
  ]

  const samplePayload: OperatorAlertPayload = {
    event: 'CRITICAL_BACKLOG_ALERT',
    severity: 'CRITICAL',
    timestamp: '2026-09-02T01:00:00.000Z',
    environment: 'test',
    alertCount: 2,
    alerts: sampleAlerts,
  }

  it('formats Slack Block Kit payload with critical colors and structured blocks', () => {
    const slackJson = formatSlackPayload(samplePayload)
    expect(slackJson.attachments).toBeDefined()
    expect(slackJson.attachments[0].color).toBe('#E53E3E') // Red for critical
    const blocks = slackJson.attachments[0].blocks
    expect(blocks[0].text.text).toContain('CRITICAL')
    expect(blocks).toHaveLength(4) // Header + Environment + 2 alert sections
  })

  it('formats Discord embed payload with correct colors and fields', () => {
    const discordJson = formatDiscordPayload(samplePayload)
    expect(discordJson.embeds).toBeDefined()
    expect(discordJson.embeds[0].color).toBe(0xff0000) // Red for critical
    expect(discordJson.embeds[0].title).toContain('CRITICAL')
    expect(discordJson.embeds[0].fields).toHaveLength(2)
    expect(discordJson.embeds[0].fields[0].name).toContain('REFUND')
  })

  it('returns 0 dispatched when alerts array is empty', async () => {
    const result = await dispatchOperatorAlert([])
    expect(result).toEqual({ dispatched: 0, failed: 0 })
  })

  it('dispatches to generic webhook with HMAC-SHA256 signature when secret is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response)
    const secret = 'super-secure-alert-secret'
    const webhookUrl = 'https://operator.example.com/webhooks/alerts'

    const result = await dispatchOperatorAlert(sampleAlerts, {
      webhookUrl,
      alertSecret: secret,
      fetchImpl: mockFetch as unknown as typeof fetch,
    })

    expect(result.dispatched).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const [calledUrl, calledInit] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe(webhookUrl)
    expect(calledInit.method).toBe('POST')
    expect(calledInit.headers['Content-Type']).toBe('application/json')
    
    // Verify HMAC signature
    const signature = calledInit.headers['x-operator-alert-signature']
    expect(signature).toBeDefined()
    const expectedSig = crypto.createHmac('sha256', secret).update(calledInit.body).digest('hex')
    expect(signature).toBe(expectedSig)
  })

  it('dispatches to Slack and Discord webhooks when configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response)
    const slackWebhookUrl = 'https://hooks.slack.com/services/T00/B00/X00'
    const discordWebhookUrl = 'https://discord.com/api/webhooks/123/xyz'

    const result = await dispatchOperatorAlert(sampleAlerts, {
      slackWebhookUrl,
      discordWebhookUrl,
      fetchImpl: mockFetch as unknown as typeof fetch,
    })

    expect(result.dispatched).toBe(2)
    expect(result.failed).toBe(0)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('fails safely without throwing when an external webhook request fails or times out', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'))
    const webhookUrl = 'https://broken.endpoint.example/alert'

    const result = await dispatchOperatorAlert(sampleAlerts, {
      webhookUrl,
      fetchImpl: mockFetch as unknown as typeof fetch,
    })

    expect(result.dispatched).toBe(0)
    expect(result.failed).toBe(1)
  })
})
