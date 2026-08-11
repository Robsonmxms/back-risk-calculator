import Joi from "joi";

const role = Joi.string().valid("admin", "analyst", "user");
const status = Joi.string().valid("active", "disabled");

export const listManagedUsersQuerySchema = Joi.object({
  role: role.required(),
  search: Joi.string().trim().max(120),
  status,
  page: Joi.number().integer().min(1).default(1),
  per_page: Joi.number().integer().min(1).max(100).default(20)
}).unknown(false);

export const createManagedUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(160).required(),
  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .max(180)
    .required(),
  role: role.required(),
  status: status.required(),
  initialPassword: Joi.string()
    .min(12)
    .max(200)
    .pattern(/[a-z]/)
    .pattern(/[A-Z]/)
    .pattern(/\d/)
    .pattern(/[^A-Za-z0-9]/)
    .required()
}).unknown(false);

export const managedUserPathSchema = Joi.object({
  userId: Joi.string().trim().min(1).max(120).required()
}).unknown(false);

export const updateManagedUserSchema = Joi.object({
  name: Joi.string().trim().min(2).max(160),
  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .max(180),
  role,
  status
})
  .min(1)
  .unknown(false);
