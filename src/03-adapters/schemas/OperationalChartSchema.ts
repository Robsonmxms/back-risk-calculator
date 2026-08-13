import Joi from "joi";

export const operationalChartsQuerySchema = Joi.object({
  range: Joi.string().valid("7d", "30d", "90d", "ytd", "1y", "all").default("30d"),
  role: Joi.string().valid("office_admin", "advisor", "analyst", "assistant", "client"),
  workflowStatus: Joi.string().valid(
    "active",
    "inactive",
    "archived",
    "invited",
    "onboarding",
    "complete",
    "paused",
    "draft",
    "pending_approval",
    "approved",
    "delivered",
    "viewed",
    "revoked",
    "pending",
    "running",
    "ready",
    "failed",
    "queued",
    "succeeded",
    "unread",
    "read",
    "open",
    "monitoring",
    "disabled"
  ),
  provider: Joi.string().trim().min(1).max(80),
  severity: Joi.string().valid("low", "medium", "high", "info", "warning", "critical")
});
