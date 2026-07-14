import { LoggerPort } from "../../02-application/ports/observability";

export class Logger implements LoggerPort {
  info(message: string, metadata?: Record<string, unknown>): void {
    process.stdout.write(
      JSON.stringify({
        level: "info",
        message,
        ...(metadata ? { metadata } : {})
      }) + "\n"
    );
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    process.stdout.write(
      JSON.stringify({
        level: "warn",
        message,
        ...(metadata ? { metadata } : {})
      }) + "\n"
    );
  }
}
