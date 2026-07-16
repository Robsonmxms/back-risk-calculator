import Joi from "joi";

export const listReviewItemsQuerySchema = Joi.object({
  status: Joi.string().valid("open", "in_progress", "closed"),
  severity: Joi.string().valid("low", "medium", "high"),
  assignedToUserId: Joi.string().trim().min(1),
  clientId: Joi.string().trim().min(1)
});

export const createReviewItemSchema = Joi.object({
  title: Joi.string().trim().min(3).max(180).required(),
  severity: Joi.string().valid("low", "medium", "high").required(),
  resourceType: Joi.string()
    .valid("client", "portfolio", "analytics", "report", "alert", "notification")
    .required(),
  resourceId: Joi.string().trim().min(1).required(),
  clientId: Joi.string().trim().min(1),
  portfolioId: Joi.string().trim().min(1),
  assignedToUserId: Joi.string().trim().min(1),
  dueDate: Joi.string().isoDate(),
  notes: Joi.string().trim().max(1000).allow("")
});

export const updateReviewItemSchema = Joi.object({
  title: Joi.string().trim().min(3).max(180),
  severity: Joi.string().valid("low", "medium", "high"),
  status: Joi.string().valid("open", "in_progress", "closed"),
  assignedToUserId: Joi.string().trim().min(1),
  dueDate: Joi.string().isoDate(),
  notes: Joi.string().trim().max(1000).allow("")
}).min(1);
