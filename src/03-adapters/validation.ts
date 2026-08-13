import { NextFunction, Request, Response } from "express";
import { ObjectSchema } from "joi";

export function validateBody(schema: ObjectSchema, options: { stripUnknown?: boolean } = {}) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const { error, value } = schema.validate(request.body, {
      abortEarly: false,
      stripUnknown: options.stripUnknown ?? true
    });

    if (error) {
      return next(error);
    }

    request.body = value;
    return next();
  };
}

export function validateParams(schema: ObjectSchema) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const { error, value } = schema.validate(request.params, {
      abortEarly: false,
      stripUnknown: false
    });

    if (error) {
      return next(error);
    }

    (request as Request & { validatedParams?: unknown }).validatedParams = value;
    return next();
  };
}

export function validateQuery(schema: ObjectSchema) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const { error, value } = schema.validate(request.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return next(error);
    }

    (request as Request & { validatedQuery?: unknown }).validatedQuery = value;
    return next();
  };
}
