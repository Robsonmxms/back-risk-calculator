export type ApplicationErrorKind =
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "not_found"
  | "unavailable";

export class ApplicationError extends Error {
  constructor(
    readonly kind: ApplicationErrorKind,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}
