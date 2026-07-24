import Joi from "joi";

export const assetHistoryQuerySchema = Joi.object({
  from: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  interval: Joi.string().valid("daily", "weekly", "monthly").default("daily")
});
