import Joi from "joi";

export const listPortfolioImportsQuerySchema = Joi.object({
  accountId: Joi.string().trim().required(),
  status: Joi.string()
    .valid("queued", "validating", "committing", "succeeded", "failed")
    .optional(),
  page: Joi.number().integer().min(1).default(1),
  per_page: Joi.number().integer().min(1).max(100).default(20)
});
