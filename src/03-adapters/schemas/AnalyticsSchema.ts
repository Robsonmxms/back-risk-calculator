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

export const analystChartsQuerySchema = Joi.object({
  portfolioIds: Joi.string().trim().allow("").optional(),
  clientId: Joi.string().trim().min(1).optional(),
  householdId: Joi.string().trim().min(1).optional(),
  accountId: Joi.string().trim().min(1).optional(),
  advisorUserId: Joi.string().trim().min(1).optional(),
  teamId: Joi.string().trim().min(1).optional(),
  range: Joi.string().valid("90d", "ytd", "1y", "3y", "5y", "all").default("1y"),
  metrics: Joi.string().trim().allow("").optional(),
  benchmarkSymbol: Joi.string().trim().uppercase().max(24).allow("").optional(),
  dataQuality: Joi.string().valid("complete", "partial", "stale", "failed").optional()
});

export const analystChartJobSchema = analystChartsQuerySchema;
