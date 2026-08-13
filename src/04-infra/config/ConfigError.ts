export type ConfigErrorCode =
  | "config.secret_id_required"
  | "config.secret_unavailable"
  | "config.secret_payload_invalid"
  | "config.schema_version_unsupported"
  | "config.source_invalid";

export class ConfigError extends Error {
  constructor(public readonly code: ConfigErrorCode) {
    super(code);
    this.name = "ConfigError";
  }
}
