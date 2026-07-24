import Joi from "joi";

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
  status: Joi.string().valid(
    "draft",
    "pending_approval",
    "approved",
    "delivered",
    "viewed",
    "revoked"
  )
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
