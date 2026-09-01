import { RefundStatus, PaymentReconciliationStatus } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'
import { dispatchOperatorAlert } from '@/backend/notifications/operatorNotifier'

export const QUEUE_AGE_WARN_MINUTES = 15
export const QUEUE_AGE_CRITICAL_MINUTES = 30

export type QueueAlert = {
  queue: 'REFUND' | 'PAYMENT_RECONCILIATION' | 'ABANDONED_CART'
  severity: 'WARN' | 'CRITICAL'
  message: string
  oldestAgeMinutes: number
  count: number
}

export type QueueHealthReport = {
  isHealthy: boolean
  hasCriticalAlerts: boolean
  checkedAt: string
  refunds: {
    pendingCount: number
    oldestAgeMinutes: number | null
    highAttemptCount: number
  }
  paymentReconciliations: {
    pendingCount: number
    oldestAgeMinutes: number | null
    highAttemptCount: number
  }
  alerts: QueueAlert[]
}

/**
 * Evaluates the age and health of recovery queues (refund outbox, payment reconciliations).
 * Emits structured warnings/errors and creates audit logs if queues exceed age thresholds.
 */
export async function checkQueueHealth(merchantId?: string): Promise<QueueHealthReport> {
  const now = Date.now()
  const alerts: QueueAlert[] = []

  // 1. Check Refund Outbox
  const pendingRefunds = await prisma.refund.findMany({
    where: {
      status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING] },
      ...(merchantId ? { order: { merchantId } } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      attemptCount: true,
      order: { select: { merchantId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const oldestRefund = pendingRefunds[0]
  const oldestRefundAgeMinutes = oldestRefund
    ? Math.floor((now - oldestRefund.createdAt.getTime()) / 60000)
    : null
  const highAttemptRefunds = pendingRefunds.filter((r) => r.attemptCount >= 3).length

  if (oldestRefundAgeMinutes !== null && oldestRefundAgeMinutes >= QUEUE_AGE_CRITICAL_MINUTES) {
    alerts.push({
      queue: 'REFUND',
      severity: 'CRITICAL',
      message: `Critical refund queue backlog: ${pendingRefunds.length} pending refund(s), oldest is ${oldestRefundAgeMinutes} minutes old (threshold: ${QUEUE_AGE_CRITICAL_MINUTES}m).`,
      oldestAgeMinutes: oldestRefundAgeMinutes,
      count: pendingRefunds.length,
    })
  } else if (oldestRefundAgeMinutes !== null && oldestRefundAgeMinutes >= QUEUE_AGE_WARN_MINUTES) {
    alerts.push({
      queue: 'REFUND',
      severity: 'WARN',
      message: `Warning: ${pendingRefunds.length} pending refund(s), oldest is ${oldestRefundAgeMinutes} minutes old (threshold: ${QUEUE_AGE_WARN_MINUTES}m).`,
      oldestAgeMinutes: oldestRefundAgeMinutes,
      count: pendingRefunds.length,
    })
  }

  // 2. Check Payment Reconciliation Queue
  const pendingReconciliations = await prisma.paymentReconciliation.findMany({
    where: {
      status: { in: [PaymentReconciliationStatus.PENDING, PaymentReconciliationStatus.PROCESSING] },
      ...(merchantId ? { order: { merchantId } } : {}),
    },
    select: {
      id: true,
      createdAt: true,
      attemptCount: true,
      order: { select: { merchantId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const oldestReconciliation = pendingReconciliations[0]
  const oldestReconciliationAgeMinutes = oldestReconciliation
    ? Math.floor((now - oldestReconciliation.createdAt.getTime()) / 60000)
    : null
  const highAttemptReconciliations = pendingReconciliations.filter((r) => r.attemptCount >= 3).length

  if (oldestReconciliationAgeMinutes !== null && oldestReconciliationAgeMinutes >= QUEUE_AGE_CRITICAL_MINUTES) {
    alerts.push({
      queue: 'PAYMENT_RECONCILIATION',
      severity: 'CRITICAL',
      message: `Critical payment reconciliation backlog: ${pendingReconciliations.length} pending reconciliation(s), oldest is ${oldestReconciliationAgeMinutes} minutes old (threshold: ${QUEUE_AGE_CRITICAL_MINUTES}m).`,
      oldestAgeMinutes: oldestReconciliationAgeMinutes,
      count: pendingReconciliations.length,
    })
  } else if (oldestReconciliationAgeMinutes !== null && oldestReconciliationAgeMinutes >= QUEUE_AGE_WARN_MINUTES) {
    alerts.push({
      queue: 'PAYMENT_RECONCILIATION',
      severity: 'WARN',
      message: `Warning: ${pendingReconciliations.length} pending reconciliation(s), oldest is ${oldestReconciliationAgeMinutes} minutes old (threshold: ${QUEUE_AGE_WARN_MINUTES}m).`,
      oldestAgeMinutes: oldestReconciliationAgeMinutes,
      count: pendingReconciliations.length,
    })
  }

  const hasCriticalAlerts = alerts.some((a) => a.severity === 'CRITICAL')
  const isHealthy = alerts.length === 0

  if (alerts.length > 0) {
    for (const alert of alerts) {
      if (alert.severity === 'CRITICAL') {
        console.error(`[QUEUE_AGE_ALERT:CRITICAL] ${alert.message}`, alert)
      } else {
        console.warn(`[QUEUE_AGE_ALERT:WARN] ${alert.message}`, alert)
      }
    }

    if (hasCriticalAlerts) {
      try {
        await prisma.auditLog.create({
          data: {
            merchantId: merchantId || oldestRefund?.order?.merchantId || oldestReconciliation?.order?.merchantId || null,
            action: 'QUEUE_AGE_ALERT',
            status: 'BLOCKED',
            reason: 'Recovery worker queue age exceeded critical threshold. Background scheduler may not be executing.',
            details: { alerts, oldestRefundAgeMinutes, oldestReconciliationAgeMinutes },
          },
        })
      } catch (err) {
        console.error('Failed to persist audit log for queue age alert:', err)
      }
    }

    // Dispatch external notifications (Slack, Discord, generic webhook)
    try {
      await dispatchOperatorAlert(alerts)
    } catch (err) {
      console.error('Failed to dispatch operator alerts:', err)
    }
  }

  return {
    isHealthy,
    hasCriticalAlerts,
    checkedAt: new Date().toISOString(),
    refunds: {
      pendingCount: pendingRefunds.length,
      oldestAgeMinutes: oldestRefundAgeMinutes,
      highAttemptCount: highAttemptRefunds,
    },
    paymentReconciliations: {
      pendingCount: pendingReconciliations.length,
      oldestAgeMinutes: oldestReconciliationAgeMinutes,
      highAttemptCount: highAttemptReconciliations,
    },
    alerts,
  }
}
