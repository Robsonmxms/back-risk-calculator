import { NextFunction, Request, Response } from "express";
import { ObjectSchema } from "joi";

export function validateBody(schema: ObjectSchema) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const { error, value } = schema.validate(request.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return next(error);
    }

    request.body = value;
    return next();
  };
}
