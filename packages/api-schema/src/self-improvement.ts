import { z } from 'zod';
import { SelfImprovementReviewSchema } from '@ujima/shared';

export const ListSelfImprovementReviewsResponseSchema = z.object({
  reviews: z.array(SelfImprovementReviewSchema),
});
export type ListSelfImprovementReviewsResponse = z.infer<
  typeof ListSelfImprovementReviewsResponseSchema
>;

export const GetSelfImprovementReviewResponseSchema = z.object({
  review: SelfImprovementReviewSchema,
});
export type GetSelfImprovementReviewResponse = z.infer<
  typeof GetSelfImprovementReviewResponseSchema
>;
