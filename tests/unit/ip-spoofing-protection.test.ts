import { describe, it, expect } from 'vitest'
import { getClientIp } from '@/backend/utils/rateLimit'

describe('IP Spoofing Protection (getClientIp)', () => {
  it('prioritizes immutable edge headers over x-forwarded-for', () => {
    const req = new Request('https://api.merchantos.com', {
      headers: new Headers({
        'x-vercel-forwarded-for': '203.0.113.1',
        'cf-connecting-ip': '198.51.100.1',
        'x-forwarded-for': '8.8.8.8, 1.2.3.4',
        'x-real-ip': '10.0.0.1',
      }),
    })
    expect(getClientIp(req)).toBe('203.0.113.1')
  })

  it('falls back to cloudflare if vercel header is missing', () => {
    const req = new Request('https://api.merchantos.com', {
      headers: new Headers({
        'cf-connecting-ip': '198.51.100.1',
        'x-forwarded-for': '8.8.8.8',
      }),
    })
    expect(getClientIp(req)).toBe('198.51.100.1')
  })

  it('parses x-forwarded-for from right-to-left skipping private IPs', () => {
    const req = new Request('https://api.merchantos.com', {
      headers: new Headers({
        // Attacker spoofed 8.8.8.8, followed by legit public IP 203.0.113.5, followed by internal load balancers
        'x-forwarded-for': '8.8.8.8, 203.0.113.5, 10.0.0.5, 192.168.1.1',
      }),
    })
    // Should skip 192.168.1.1 and 10.0.0.5, selecting 203.0.113.5
    expect(getClientIp(req)).toBe('203.0.113.5')
  })

  it('rejects completely local/private x-forwarded-for chains and falls back to x-real-ip', () => {
    const req = new Request('https://api.merchantos.com', {
      headers: new Headers({
        'x-forwarded-for': '127.0.0.1, 10.0.0.1',
        'x-real-ip': '203.0.113.9',
      }),
    })
    expect(getClientIp(req)).toBe('203.0.113.9')
  })

  it('returns unknown if no valid public IPs exist', () => {
    const req = new Request('https://api.merchantos.com', {
      headers: new Headers({
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '10.0.0.1',
      }),
    })
    expect(getClientIp(req)).toBe('unknown')
  })

  it('handles empty headers gracefully', () => {
    const req = new Request('https://api.merchantos.com')
    expect(getClientIp(req)).toBe('unknown')
  })
})
