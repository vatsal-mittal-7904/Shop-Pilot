import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { extractExplicitBudgetInPaise } from '../../src/backend/actions/intent'

describe('explicit buyer budget parsing', () => {
  test('stores a plain rupee budget in paise without losing two zeroes', () => {
    assert.equal(extractExplicitBudgetInPaise('budget 7000 needed mouse'), 700_000)
    assert.equal(extractExplicitBudgetInPaise('budget 70000 needed mouse'), 7_000_000)
  })

  test('accepts common Indian currency formats', () => {
    assert.equal(extractExplicitBudgetInPaise('under ₹7,000'), 700_000)
    assert.equal(extractExplicitBudgetInPaise('rupees 3499.50'), 349_950)
  })
})
