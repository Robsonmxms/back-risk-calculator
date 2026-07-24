import Joi from "joi";

export const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  password: Joi.string().min(8).required()
});

export const googleLoginSchema = Joi.object({
  idToken: Joi.string(),
  code: Joi.string(),
  redirectUri: Joi.string().uri()
}).or("idToken", "code");

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().min(32).required()
});

export const logoutSchema = Joi.object({
  refreshToken: Joi.string().min(32).required()
});
