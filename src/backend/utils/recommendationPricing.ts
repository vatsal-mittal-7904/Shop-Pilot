export type CartItemInput = {
  productId: string;
  quantity: number;
  product: { id: string; price: number; cost?: number };
};

export type ProductInput = {
  id: string;
  price: number;
};

export function calculateCrossSellPricing(params: {
  cartItems: CartItemInput[];
  addonProduct: ProductInput;
  discountPercent: number;
}) {
  const { cartItems, addonProduct, discountPercent } = params;

  let subtotal = 0;
  const discountAmount = Math.floor(addonProduct.price * (discountPercent / 100));
  const offerItems: Array<{ productId: string; quantity: number; unitPrice: number; lineTotal: number }> = [];

  let addonFound = false;

  for (const item of cartItems) {
    if (item.productId === addonProduct.id) {
      addonFound = true;
      // 1 unit discounted
      const discountedUnitPrice = addonProduct.price - discountAmount;
      offerItems.push({
        productId: addonProduct.id,
        quantity: 1,
        unitPrice: discountedUnitPrice,
        lineTotal: discountedUnitPrice,
      });

      // The rest of the pre-existing units are full price
      if (item.quantity > 0) {
        const fullPriceTotal = item.quantity * item.product.price;
        offerItems.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.product.price,
          lineTotal: fullPriceTotal,
        });
        subtotal += fullPriceTotal;
      }
    } else {
      const lineTotal = item.quantity * item.product.price;
      offerItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.product.price,
        lineTotal,
      });
      subtotal += lineTotal;
    }
  }

  // If addon product wasn't already in the cart, add it now.
  if (!addonFound) {
    const discountedUnitPrice = addonProduct.price - discountAmount;
    offerItems.push({
      productId: addonProduct.id,
      quantity: 1,
      unitPrice: discountedUnitPrice,
      lineTotal: discountedUnitPrice,
    });
  }

  subtotal += addonProduct.price; // Subtotal includes the full price of the 1 added unit
  const total = subtotal - discountAmount;

  return { subtotal, discountAmount, total, offerItems };
}

export function calculateUpsellPricing(params: {
  cartItems: CartItemInput[];
  originalProduct: ProductInput;
  upgradeProduct: ProductInput;
  discountPercent: number;
}) {
  const { cartItems, originalProduct, upgradeProduct, discountPercent } = params;

  let subtotal = 0;
  const discountAmount = Math.floor(upgradeProduct.price * (discountPercent / 100));
  const offerItems: Array<{ productId: string; quantity: number; unitPrice: number; lineTotal: number }> = [];

  let originalFound = false;

  for (const item of cartItems) {
    if (item.productId === originalProduct.id && !originalFound) {
      originalFound = true;
      // We swap ONE unit of originalProduct for upgradeProduct
      if (item.quantity > 1) {
        const fullPriceTotal = (item.quantity - 1) * item.product.price;
        offerItems.push({
          productId: item.productId,
          quantity: item.quantity - 1,
          unitPrice: item.product.price,
          lineTotal: fullPriceTotal,
        });
        subtotal += fullPriceTotal;
      }
    } else if (item.productId === upgradeProduct.id) {
      const fullPriceTotal = item.quantity * item.product.price;
      offerItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.product.price,
        lineTotal: fullPriceTotal,
      });
      subtotal += fullPriceTotal;
    } else {
      const lineTotal = item.quantity * item.product.price;
      offerItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.product.price,
        lineTotal,
      });
      subtotal += lineTotal;
    }
  }

  // The 1 unit of upgradeProduct that replaces the originalProduct
  if (originalFound) {
    const discountedUnitPrice = upgradeProduct.price - discountAmount;
    offerItems.push({
      productId: upgradeProduct.id,
      quantity: 1,
      unitPrice: discountedUnitPrice,
      lineTotal: discountedUnitPrice,
    });
    subtotal += upgradeProduct.price;
  }

  const total = subtotal - discountAmount;

  return { subtotal, discountAmount, total, offerItems };
}
