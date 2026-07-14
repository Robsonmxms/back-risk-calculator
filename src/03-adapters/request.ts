import { Request } from "express";
import { Actor } from "../01-domain/auth/actor";

export interface AuthenticatedRequest extends Request {
  actor: Actor;
}
