import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}))

vi.mock('@/backend/db/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}))

import { GET } from '@/app/api/health/route'

describe('GET /api/health endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 and healthy status when database is reachable', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ ping: 1 }])

    const response = await GET()
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.status).toBe('healthy')
    expect(data.database.status).toBe('connected')
    expect(typeof data.database.latencyMs).toBe('number')
    expect(typeof data.uptimeSeconds).toBe('number')
  })

  it('returns 503 and unhealthy status when database query fails', async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error('Connection refused'))

    const response = await GET()
    expect(response.status).toBe(503)

    const data = await response.json()
    expect(data.status).toBe('unhealthy')
    expect(data.database.status).toBe('disconnected')
    expect(data.database.error).toContain('Connection refused')
  })
})
