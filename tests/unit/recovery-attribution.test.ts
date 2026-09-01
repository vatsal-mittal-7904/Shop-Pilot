import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock('@/backend/db/prisma', () => ({
  prisma: { order: { findMany: mocks.findMany } },
}))

import { getRecoveryAttribution } from '@/backend/actions/recoveryAttribution'

describe('recovery attribution', () => {
  beforeEach(() => vi.resetAllMocks())

  test('counts only paid orders linked to a completed recovery campaign', async () => {
    mocks.findMany.mockResolvedValue([
      { totalAmount: 125000, offer: { campaign: { type: 'RECOVERY', status: 'COMPLETED' } } },
      { totalAmount: 99900, offer: { campaign: { type: 'BUNDLE', status: 'COMPLETED' } } },
    ])

    await expect(getRecoveryAttribution('d560ebdc-263c-4edb-82f7-f46b12ba5b65')).resolves.toEqual({
      revenue: 125000,
      recoveredOrders: 1,
    })

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'PAID',
      }),
      select: expect.objectContaining({ totalAmount: true, offer: expect.any(Object) }),
    }))
  })
})
