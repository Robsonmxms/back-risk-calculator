import Joi from "joi";

export const createPortfolioSchema = Joi.object({
  accountId: Joi.string().required(),
  name: Joi.string().trim().min(2).max(120).required(),
  description: Joi.string().trim().max(400).allow("").optional(),
  baseCurrency: Joi.string().trim().length(3).required()
});

export const updatePortfolioSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  description: Joi.string().trim().max(400).allow("").optional()
}).or("name", "description");

export const createPortfolioTransactionSchema = Joi.object({
  assetSymbol: Joi.string().trim().min(1).max(24).required(),
  assetName: Joi.string().trim().min(1).max(160).required(),
  tradeDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  type: Joi.string().valid("buy", "sell").required(),
  quantity: Joi.number().positive().required(),
  unitPrice: Joi.number().positive().required(),
  currency: Joi.string().trim().length(3).required(),
  notes: Joi.string().trim().max(400).allow("").optional()
});
