import { NextFunction, Request, Response } from "express";
import { ValidationError } from "joi";
import { ApplicationError } from "../02-application/errors/application-error";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(response: Response, data: T, meta?: Record<string, unknown>) {
  return response.json(meta ? { data, meta } : { data });
}

export function noContent(response: Response) {
  return response.status(204).send();
}

export function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>
) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function errorHandler(
  error: Error,
  _request: Request,
  response: Response,
  _next: NextFunction
) {
  if (error instanceof ApplicationError) {
    return response.status(statusCodeFor(error)).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    });
  }

  if (error instanceof ApiError) {
    return response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    });
  }

  if (error instanceof ValidationError) {
    return response.status(400).json({
      error: {
        code: "request.validation_failed",
        message: "Request validation failed",
        details: {
          fields: error.details.map((detail) => ({
            path: detail.path.join("."),
            message: detail.message
          }))
        }
      }
    });
  }

  return response.status(500).json({
    error: {
      code: "internal.unexpected_error",
      message: "Unexpected error"
    }
  });
}

function statusCodeFor(error: ApplicationError): number {
  switch (error.kind) {
    case "invalid":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "unavailable":
      return 503;
  }
}
