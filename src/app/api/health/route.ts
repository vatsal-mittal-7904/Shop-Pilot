import { prisma } from '@/backend/db/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startTime = Date.now()

  try {
    // Verify database connectivity
    await prisma.$queryRaw`SELECT 1 as ping`
    const latencyMs = Date.now() - startTime

    return Response.json(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: 'connected',
          latencyMs,
        },
        environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
      },
      { status: 200 }
    )
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown database error'

    console.error('Health check failed:', errorMessage)

    return Response.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: 'disconnected',
          latencyMs,
          error: errorMessage,
        },
        environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
      },
      { status: 503 }
    )
  }
}
