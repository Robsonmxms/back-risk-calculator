import Joi from "joi";

export const updateOfficeSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  status: Joi.string().valid("active", "disabled")
}).min(1);
