import {
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";
import { createHash } from "crypto";
import { ConfigError } from "./ConfigError";
import { ConfigSource } from "./ConfigSource";

export class AwsSecretsManagerConfigSource implements ConfigSource {
  readonly kind = "aws-secrets-manager" as const;
  readonly safeIdentifier: string;

  constructor(
    private readonly client: Pick<SecretsManagerClient, "send">,
    private readonly secretId: string
  ) {
    this.safeIdentifier = createHash("sha256").update(secretId).digest("hex").slice(0, 12);
  }

  async load(): Promise<unknown> {
    let response: GetSecretValueCommandOutput;
    try {
      response = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretId }));
    } catch {
      throw new ConfigError("config.secret_unavailable");
    }

    if (!response.SecretString || response.SecretBinary) {
      throw new ConfigError("config.secret_payload_invalid");
    }

    try {
      return JSON.parse(response.SecretString) as unknown;
    } catch {
      throw new ConfigError("config.secret_payload_invalid");
    }
  }
}
