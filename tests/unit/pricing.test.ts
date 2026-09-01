import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { calculateCrossSellPricing, calculateUpsellPricing } from '../../src/backend/utils/recommendationPricing';

describe('Pricing Utility', () => {
  test('Cross-sell discount applies strictly to ONE unit of the add-on', () => {
    const cartItems = [
      { productId: 'p1', quantity: 1, product: { id: 'p1', price: 500000 } } // 5000.00
    ];
    const addonProduct = { id: 'p2', price: 349900 }; // 3499.00
    
    const result = calculateCrossSellPricing({
      cartItems,
      addonProduct,
      discountPercent: 10,
    });

    assert.equal(result.discountAmount, 34990); // 10% of 3499.00
    assert.equal(result.subtotal, 500000 + 349900);
    assert.equal(result.total, 849900 - 34990);

    const keyboardItem = result.offerItems.find(i => i.productId === 'p1');
    const mouseItem = result.offerItems.find(i => i.productId === 'p2');
    
    assert.ok(keyboardItem);
    assert.ok(mouseItem);
    assert.equal(keyboardItem.lineTotal, 500000); // Undiscounted
    assert.equal(mouseItem.lineTotal, 349900 - 34990); // Discounted
    
    const sum = result.offerItems.reduce((acc, i) => acc + i.lineTotal, 0);
    assert.equal(sum, result.total, 'Offer.total === exact sum of OfferItem line totals');
  });

  test('Cross-sell with pre-existing add-on quantities', () => {
    const cartItems = [
      { productId: 'p1', quantity: 1, product: { id: 'p1', price: 500000 } },
      { productId: 'p2', quantity: 2, product: { id: 'p2', price: 349900 } } // They already have 2 mice
    ];
    const addonProduct = { id: 'p2', price: 349900 };
    
    const result = calculateCrossSellPricing({
      cartItems,
      addonProduct,
      discountPercent: 10,
    });

    assert.equal(result.discountAmount, 34990); 
    assert.equal(result.subtotal, 500000 + (349900 * 2) + 349900); // Original + 1 added
    assert.equal(result.total, result.subtotal - 34990);

    const mouseItems = result.offerItems.filter(i => i.productId === 'p2');
    assert.equal(mouseItems.length, 2); // 1 discounted, 1 for the pre-existing 2 units
    
    const discountedMouse = mouseItems.find(i => i.quantity === 1 && i.unitPrice < addonProduct.price);
    const fullPriceMice = mouseItems.find(i => i.quantity === 2);
    
    assert.ok(discountedMouse);
    assert.ok(fullPriceMice);
    assert.equal(fullPriceMice.lineTotal, 349900 * 2);

    const sum = result.offerItems.reduce((acc, i) => acc + i.lineTotal, 0);
    assert.equal(sum, result.total, 'Offer.total === exact sum of OfferItem line totals');
  });

  test('Upsell discount applies strictly to ONE unit of the upgrade product', () => {
    const cartItems = [
      { productId: 'p1', quantity: 3, product: { id: 'p1', price: 500000 } } // 3 standard keyboards
    ];
    const originalProduct = { id: 'p1', price: 500000 };
    const upgradeProduct = { id: 'p3', price: 700000 };
    
    const result = calculateUpsellPricing({
      cartItems,
      originalProduct,
      upgradeProduct,
      discountPercent: 20,
    });

    assert.equal(result.discountAmount, 140000); // 20% of 7000.00
    assert.equal(result.subtotal, (500000 * 2) + 700000); // 2 standard + 1 pro
    assert.equal(result.total, result.subtotal - 140000);

    const standardItems = result.offerItems.filter(i => i.productId === 'p1');
    const proItems = result.offerItems.filter(i => i.productId === 'p3');

    assert.equal(standardItems.length, 1);
    assert.equal(standardItems[0].quantity, 2);
    assert.equal(standardItems[0].lineTotal, 500000 * 2);

    assert.equal(proItems.length, 1);
    assert.equal(proItems[0].quantity, 1);
    assert.equal(proItems[0].lineTotal, 700000 - 140000);

    const sum = result.offerItems.reduce((acc, i) => acc + i.lineTotal, 0);
    assert.equal(sum, result.total, 'Offer.total === exact sum of OfferItem line totals');
  });

  test('Upsell replaces one original even when the cart already contains that upgrade', () => {
    // This is the shape that previously produced the incorrect "add another
    // Pro keyboard" subtotal in the upgrade card.
    const cartItems = [
      { productId: 'standard', quantity: 3, product: { id: 'standard', price: 749900 } },
      { productId: 'pro', quantity: 1, product: { id: 'pro', price: 1049900 } },
    ];

    const result = calculateUpsellPricing({
      cartItems,
      originalProduct: { id: 'standard', price: 749900 },
      upgradeProduct: { id: 'pro', price: 1049900 },
      discountPercent: 10,
    });

    // 2 standard + the existing Pro + one discounted replacement Pro.
    assert.equal(result.subtotal, (2 * 749900) + 1049900 + 1049900);
    assert.equal(result.discountAmount, 104990);
    assert.equal(result.total, 3599600 - 104990);
    assert.equal(result.offerItems.reduce((sum, item) => sum + item.lineTotal, 0), result.total);
  });
});
