import { test, expect } from '@playwright/test'

const CUSTOMER_EMAIL = process.env.DEMO_CUSTOMER_EMAIL || 'demo.customer@technest.com'
const CUSTOMER_PASSWORD = process.env.DEMO_CUSTOMER_PASSWORD || 'technest-customer-demo'

test.describe('Buyer checkout consent', () => {
  test('rejects checkout until the signed-in buyer accepts the exact offer', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Email').fill(CUSTOMER_EMAIL)
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page).toHaveURL(/\/agent$/)

    const catalog = await page.request.get('/api/agent/catalog')
    expect(catalog.ok()).toBeTruthy()
    const catalogData = await catalog.json() as { products: Array<{ id: string }> }
    expect(catalogData.products.length).toBeGreaterThan(0)

    const cartResponse = await page.request.post('/api/agent/cart', {
      data: { productId: catalogData.products[0].id },
    })
    expect(cartResponse.ok()).toBeTruthy()

    const offerResponse = await page.request.post('/api/agent/offer', {
      data: { discountPercentage: 0 },
    })
    expect(offerResponse.ok()).toBeTruthy()
    const { offer } = await offerResponse.json() as { offer: { id: string } }

    const checkoutBeforeAcceptance = await page.request.post('/api/agent/order', { data: { offerId: offer.id } })
    expect(checkoutBeforeAcceptance.status()).toBe(400)
    await expect(checkoutBeforeAcceptance.json()).resolves.toMatchObject({
      error: expect.stringMatching(/customer acceptance is required/i),
    })

    const acceptance = await page.request.post('/api/agent/offer/accept', { data: { offerId: offer.id } })
    expect(acceptance.ok()).toBeTruthy()
    await expect(acceptance.json()).resolves.toMatchObject({
      acceptance: { offerId: offer.id, alreadyAccepted: false },
    })
  })
})
