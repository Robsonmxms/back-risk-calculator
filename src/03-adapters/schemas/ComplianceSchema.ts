import Joi from "joi";

const auditResourceTypes = [
  "auth",
  "office",
  "permission",
  "client",
  "household",
  "account",
  "portfolio",
  "ledger",
  "analytics",
  "market_data",
  "report",
  "alert",
  "notification",
  "delivery",
  "portal",
  "review"
];

const chartRanges = ["7d", "30d", "90d", "ytd", "1y", "all"];

export const listAuditEventsQuerySchema = Joi.object({
  actorId: Joi.string().trim().min(1),
  action: Joi.string().trim().min(1).max(120),
  outcome: Joi.string().valid("success", "failure"),
  severity: Joi.string().valid("info", "warning", "critical"),
  resourceType: Joi.string().valid(...auditResourceTypes),
  resourceId: Joi.string().trim().min(1),
  clientId: Joi.string().trim().min(1),
  portfolioId: Joi.string().trim().min(1),
  from: Joi.string().isoDate(),
  to: Joi.string().isoDate(),
  page: Joi.number().integer().min(1),
  pageSize: Joi.number().integer().min(1).max(100)
});

export const listSupervisionReviewsQuerySchema = Joi.object({
  status: Joi.string().valid("open", "assigned", "resolved"),
  severity: Joi.string().valid("info", "warning", "critical"),
  assignedToUserId: Joi.string().trim().min(1)
});

export const updateSupervisionReviewSchema = Joi.object({
  status: Joi.string().valid("open", "assigned", "resolved"),
  assignedToUserId: Joi.string().trim().min(1).allow(""),
  resolutionComment: Joi.string().trim().max(1000).allow("")
}).min(1);

export const createAuditExportSchema = Joi.object({
  format: Joi.string().valid("csv", "json").required(),
  filters: listAuditEventsQuerySchema
});

export const complianceChartsQuerySchema = Joi.object({
  range: Joi.string().valid(...chartRanges).default("30d"),
  resourceType: Joi.string().valid(...auditResourceTypes),
  action: Joi.string().trim().min(1).max(120),
  severity: Joi.string().valid("info", "warning", "critical"),
  status: Joi.string().valid("open", "assigned", "resolved"),
  assigneeUserId: Joi.string().trim().min(1)
});
