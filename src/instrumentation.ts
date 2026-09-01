export async function register() {
  // Next runs instrumentation in multiple runtimes; the database check is
  // Node-only and must finish before this server instance accepts requests.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
    const [{ prisma }, { assertNoDemoAccountsInProduction }] = await Promise.all([
      import('@/backend/db/prisma'),
      import('@/backend/security/demoSafety'),
    ])
    await assertNoDemoAccountsInProduction(prisma)
  }
}
