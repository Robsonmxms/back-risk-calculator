export type ConfigSourceKind = "environment" | "memory" | "aws-secrets-manager";

export interface ConfigSource {
  readonly kind: ConfigSourceKind;
  readonly safeIdentifier?: string;
  load(): Promise<unknown>;
}
