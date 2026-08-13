import Joi from "joi";

const chartRanges = ["7d", "30d", "90d", "ytd", "1y", "all"];
const packageStatuses = ["draft", "pending_approval", "approved", "delivered", "viewed", "revoked"];

const packageItemSchema = Joi.object({
  id: Joi.string().trim().min(1),
  type: Joi.string().valid("report", "analytics_snapshot", "portfolio_summary").required(),
  title: Joi.string().trim().min(2).max(180).required(),
  portfolioId: Joi.string().trim().min(1),
  reportId: Joi.string().trim().min(1),
  analyticsSnapshotId: Joi.string().trim().min(1),
  format: Joi.string().valid("pdf", "csv", "json"),
  status: Joi.string().valid("ready", "pending", "unavailable")
});

export const listReportPackagesQuerySchema = Joi.object({
  status: Joi.string().valid(...packageStatuses)
});

export const createReportPackageSchema = Joi.object({
  title: Joi.string().trim().min(3).max(180).required(),
  summaryNotes: Joi.string().trim().min(3).max(1200).required(),
  internalNotes: Joi.string().trim().max(1200).allow(""),
  items: Joi.array().items(packageItemSchema).min(1).required(),
  submitForApproval: Joi.boolean()
});

export const updateReportPackageSchema = Joi.object({
  title: Joi.string().trim().min(3).max(180),
  summaryNotes: Joi.string().trim().min(3).max(1200),
  internalNotes: Joi.string().trim().max(1200).allow(""),
  status: Joi.string().valid("draft", "pending_approval"),
  items: Joi.array().items(packageItemSchema).min(1)
}).min(1);

export const deliveryChartsQuerySchema = Joi.object({
  range: Joi.string()
    .valid(...chartRanges)
    .default("30d"),
  packageStatus: Joi.string().valid(...packageStatuses),
  deliveryStatus: Joi.string().valid(
    ...packageStatuses,
    "pending",
    "running",
    "ready",
    "failed",
    "unread",
    "read",
    "success",
    "failure"
  ),
  channel: Joi.string().trim().min(1).max(80),
  clientId: Joi.string().trim().min(1),
  householdId: Joi.string().trim().min(1),
  advisorUserId: Joi.string().trim().min(1)
});
