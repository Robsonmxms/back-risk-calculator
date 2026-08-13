import Joi from "joi";

export const requestReportSchema = Joi.object({
  format: Joi.string().valid("pdf", "csv").required()
});

const alertConditionSchema = Joi.object({
  eventType: Joi.string()
    .valid("analytics.updated", "market_data.updated", "report.generated", "metric_threshold")
    .required(),
  metricKey: Joi.string()
    .valid(
      "totalReturn",
      "annualizedReturn",
      "maxDrawdown",
      "volatility",
      "beta",
      "sharpeRatio",
      "concentrationHhi",
      "sectorExposure",
      "assetCorrelation"
    )
    .when("eventType", { is: "metric_threshold", then: Joi.required(), otherwise: Joi.optional() }),
  operator: Joi.string()
    .valid("gte", "lte")
    .when("eventType", { is: "metric_threshold", then: Joi.required(), otherwise: Joi.optional() }),
  threshold: Joi.number().when("eventType", {
    is: "metric_threshold",
    then: Joi.required(),
    otherwise: Joi.optional()
  })
});

export const createAlertSchema = Joi.object({
  title: Joi.string().trim().min(3).max(160).required(),
  severity: Joi.string().valid("low", "medium", "high").required(),
  condition: alertConditionSchema.optional()
});

export const updateAlertSchema = Joi.object({
  title: Joi.string().trim().min(3).max(160),
  severity: Joi.string().valid("low", "medium", "high"),
  status: Joi.string().valid("open", "monitoring", "disabled"),
  condition: alertConditionSchema
}).min(1);
