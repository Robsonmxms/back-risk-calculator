import type { Response } from "express";
import type { Actor } from "../../01-domain/auth/actor";

/** HTTP delivery abstraction implemented by the outer realtime infrastructure. */
export interface RealtimeSubscriptionPort {
  subscribe(actor: Actor, response: Response, portfolioId?: string): string;
}
