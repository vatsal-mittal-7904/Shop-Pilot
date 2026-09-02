import { Prisma } from '@prisma/client'
import { prisma } from '@/backend/db/prisma'

export interface RetryTransactionOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  backoffFactor?: number
  isolationLevel?: Prisma.TransactionIsolationLevel
}

/**
 * Executes a database transaction with automatic retry on serialization conflicts
 * (Prisma P2034, PostgreSQL 40001, PostgreSQL 40P01 deadlock).
 *
 * Implements exponential backoff with randomized jitter to prevent thundering herds.
 */
export async function withRetryTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: RetryTransactionOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3
  const baseDelayMs = options.baseDelayMs ?? 50
  const maxDelayMs = options.maxDelayMs ?? 1000
  const backoffFactor = options.backoffFactor ?? 2
  const isolationLevel = options.isolationLevel ?? 'Serializable'

  let attempt = 0

  while (true) {
    try {
      return await prisma.$transaction(fn, { isolationLevel })
    } catch (error) {
      attempt += 1

      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2028') // P2034: Transaction failed due to write conflict / deadlock

      const isDeadlockError =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string' &&
        ((error as { message: string }).message.includes('deadlock detected') ||
          (error as { message: string }).message.includes('could not serialize access due to concurrent update'))

      if ((isSerializationConflict || isDeadlockError) && attempt <= maxRetries) {
        // Compute exponential backoff with randomized jitter
        const jitter = Math.floor(Math.random() * 40)
        const delay = Math.min(baseDelayMs * Math.pow(backoffFactor, attempt - 1) + jitter, maxDelayMs)

        console.warn(
          `[RETRY_TRANSACTION:CONFLICT] Serialization conflict on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`
        )

        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      throw error
    }
  }
}
