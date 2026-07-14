import { createHash, randomBytes } from "crypto";
import {
  PlainRefreshToken,
  RefreshTokenGenerator
} from "../../02-application/ports/security";

export class Sha256RefreshTokenGenerator implements RefreshTokenGenerator {
  generate(): PlainRefreshToken {
    const token = randomBytes(48).toString("base64url");
    return {
      token,
      tokenHash: this.hash(token)
    };
  }

  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
