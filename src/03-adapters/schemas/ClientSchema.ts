import Joi from "joi";

export const listClientsQuerySchema = Joi.object({
  search: Joi.string().trim().max(120),
  status: Joi.string().valid("active", "inactive", "archived"),
  advisorUserId: Joi.string().trim().min(1),
  householdId: Joi.string().trim().min(1),
  onboardingStatus: Joi.string().valid("invited", "onboarding", "complete", "paused")
});

export const createClientSchema = Joi.object({
  householdId: Joi.string().trim().min(1),
  name: Joi.string().trim().min(2).max(160).required(),
  email: Joi.string().trim().email().max(180).required(),
  phone: Joi.string().trim().max(40).allow(""),
  documentLabel: Joi.string().trim().max(80).allow(""),
  onboardingStatus: Joi.string().valid("invited", "onboarding", "complete", "paused"),
  advisorUserId: Joi.string().trim().min(1),
  riskProfileDescriptor: Joi.string().trim().min(2).max(120),
  notes: Joi.string().trim().max(1000).allow("")
});

export const updateClientSchema = Joi.object({
  householdId: Joi.string().trim().min(1),
  name: Joi.string().trim().min(2).max(160),
  email: Joi.string().trim().email().max(180),
  phone: Joi.string().trim().max(40).allow(""),
  documentLabel: Joi.string().trim().max(80).allow(""),
  status: Joi.string().valid("active", "inactive", "archived"),
  onboardingStatus: Joi.string().valid("invited", "onboarding", "complete", "paused"),
  advisorUserId: Joi.string().trim().min(1),
  riskProfileDescriptor: Joi.string().trim().min(2).max(120),
  notes: Joi.string().trim().max(1000).allow("")
}).min(1);

export const createHouseholdSchema = Joi.object({
  name: Joi.string().trim().min(2).max(160).required()
});

export const updateHouseholdSchema = Joi.object({
  name: Joi.string().trim().min(2).max(160),
  status: Joi.string().valid("active", "archived")
}).min(1);
