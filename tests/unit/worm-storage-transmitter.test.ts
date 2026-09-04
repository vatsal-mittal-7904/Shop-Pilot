import { describe, it, expect, vi, beforeEach } from 'vitest'
import { replicateAuditEntryOffDb } from '@/backend/security/wormStorageTransmitter'

describe('External Audit Sink & WORM Replication (wormStorageTransmitter)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('transmits signed headers and JSON payload to external compliance sink successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
    })
    const mockAlert = vi.fn().mockResolvedValue({ dispatched: 1, failed: 0 })

    await replicateAuditEntryOffDb(
      'entry-123',
      'hash-abc',
      'sig-xyz',
      {
        externalSinkUrl: 'https://compliance.example.com/audit-sink',
        fetchImpl: mockFetch as unknown as typeof fetch,
        alertDispatcher: mockAlert,
      }
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://compliance.example.com/audit-sink')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Audit-Signature']).toBe('sig-xyz')
    expect(init.headers['X-Audit-Hash']).toBe('hash-abc')
    expect(init.headers['X-Audit-Entry-Id']).toBe('entry-123')

    const body = JSON.parse(init.body)
    expect(body.id).toBe('entry-123')
    expect(body.hash).toBe('hash-abc')
    expect(body.signature).toBe('sig-xyz')

    // No alert dispatched on success
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('dispatches critical operator alarm when external compliance sink returns HTTP 500 error', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    })
    const mockAlert = vi.fn().mockResolvedValue({ dispatched: 1, failed: 0 })

    await replicateAuditEntryOffDb(
      'entry-fail-500',
      'hash-fail',
      'sig-fail',
      {
        externalSinkUrl: 'https://compliance.example.com/audit-sink',
        fetchImpl: mockFetch as unknown as typeof fetch,
        alertDispatcher: mockAlert,
      }
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-fail-500',
        hash: 'hash-fail',
        sinkUrl: 'https://compliance.example.com/audit-sink',
        reason: expect.stringContaining('HTTP 500'),
      })
    )
  })

  it('dispatches critical operator alarm when external sink network request throws or times out', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Connection timed out'))
    const mockAlert = vi.fn().mockResolvedValue({ dispatched: 1, failed: 0 })

    await replicateAuditEntryOffDb(
      'entry-timeout',
      'hash-timeout',
      'sig-timeout',
      {
        externalSinkUrl: 'https://compliance.example.com/audit-sink',
        fetchImpl: mockFetch as unknown as typeof fetch,
        alertDispatcher: mockAlert,
      }
    )

    expect(mockAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-timeout',
        hash: 'hash-timeout',
        sinkUrl: 'https://compliance.example.com/audit-sink',
        reason: expect.stringContaining('Connection timed out'),
      })
    )
  })

  it('dispatches operator alarm when local mirror file append fails', async () => {
    const mockAlert = vi.fn().mockResolvedValue({ dispatched: 1, failed: 0 })

    // Invalid artifacts path targeting a non-existent or root protected path
    await replicateAuditEntryOffDb(
      'entry-local-err',
      'hash-local',
      'sig-local',
      {
        artifactsDir: '/dev/null/invalid-dir/forbidden',
        alertDispatcher: mockAlert,
      }
    )

    expect(mockAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-local-err',
        hash: 'hash-local',
        sinkUrl: expect.stringContaining('Local Mirror File'),
        reason: expect.stringContaining('Local audit file append failed'),
      })
    )
  })

  it('never throws unhandled exceptions to caller even when alert dispatcher fails', async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Sink down'))
    const mockAlert = vi.fn().mockRejectedValueOnce(new Error('Alert channel down'))

    // Should resolve cleanly without crashing
    await expect(
      replicateAuditEntryOffDb(
        'entry-resilient',
        'hash-resilient',
        'sig-resilient',
        {
          externalSinkUrl: 'https://compliance.example.com/audit-sink',
          fetchImpl: mockFetch as unknown as typeof fetch,
          alertDispatcher: mockAlert,
        }
      )
    ).resolves.toBeUndefined()
  })
})
