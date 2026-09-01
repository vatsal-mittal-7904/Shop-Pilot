import { z } from 'zod';

export const productRelationshipListSchema = z.array(z.string().uuid()).refine((items) => new Set(items).size === items.length, {
  message: 'Duplicate product IDs are not allowed',
});

export const productRelationshipPayloadSchema = z.object({
  sourceProductId: z.string().uuid().optional(),
  relatedProductIds: productRelationshipListSchema,
}).refine((data) => {
  if (!data.sourceProductId) return true;
  return !data.relatedProductIds.includes(data.sourceProductId);
}, {
  message: 'Product cannot be related to itself',
  path: ['relatedProductIds'],
});
