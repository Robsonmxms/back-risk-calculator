import Joi from "joi";

export const portfolioChartsQuerySchema = Joi.object({
  range: Joi.string()
    .valid("1m", "3m", "6m", "ytd", "1y", "3y", "5y", "all")
    .default("1y"),
  interval: Joi.string().valid("daily", "weekly", "monthly").default("daily"),
  baseCurrency: Joi.string().trim().uppercase().length(3).optional(),
  assetSymbols: Joi.string().trim().allow("").optional(),
  benchmarkSymbol: Joi.string().trim().uppercase().max(24).allow("").optional(),
  include: Joi.string().trim().allow("").optional()
});
