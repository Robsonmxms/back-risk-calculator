import Joi from "joi";

export const updateOfficeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  status: Joi.string().valid("active", "disabled")
}).min(1);

export const createTeamSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  description: Joi.string().trim().max(500).allow(""),
  memberUserIds: Joi.array().items(Joi.string().trim().min(1)).default([])
});

export const updateTeamSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  description: Joi.string().trim().max(500).allow(""),
  status: Joi.string().valid("active", "archived"),
  memberUserIds: Joi.array().items(Joi.string().trim().min(1))
}).min(1);

export const createAssignmentSchema = Joi.object({
  officeId: Joi.string().trim().min(1).required(),
  assigneeUserId: Joi.string().trim().min(1),
  teamId: Joi.string().trim().min(1),
  resourceType: Joi.string().valid("client", "household", "account", "portfolio").default("client"),
  resourceId: Joi.string().trim().min(1),
  permissions: Joi.array()
    .items(
      Joi.string().valid(
        "client.read",
        "client.manage",
        "ledger.read",
        "ledger.write",
        "analytics.read",
        "analytics.recompute",
        "reports.request",
        "reports.approve",
        "alerts.manage",
        "notifications.read",
        "office.members.manage",
        "audit.read"
      )
    )
    .min(1)
    .required()
}).or("assigneeUserId", "teamId");
