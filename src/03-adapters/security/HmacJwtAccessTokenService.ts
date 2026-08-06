import { createHmac, timingSafeEqual } from "crypto";
import { AccessTokenClaims } from "../../01-domain/auth/actor";
import { ApplicationError } from "../../02-application/errors/application-error";
import { AccessTokenService } from "../../02-application/ports/security";

type JwtPayload = AccessTokenClaims & {
  iat: number;
  exp: number;
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

export class HmacJwtAccessTokenService implements AccessTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number
  ) {}

  sign(claims: AccessTokenClaims): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: "HS256", typ: "JWT" });
    const payload = encode({
      ...claims,
      iat: now,
      exp: now + this.ttlSeconds
    });

    return `${header}.${payload}.${this.signPart(`${header}.${payload}`)}`;
  }

  verify(token: string): AccessTokenClaims {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new ApplicationError(
        "unauthorized",
        "auth.access_token_invalid",
        "Invalid access token"
      );
    }

    const [header, payload, signature] = parts;
    const expectedSignature = this.signPart(`${header}.${payload}`);
    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(signature);

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ApplicationError(
        "unauthorized",
        "auth.access_token_invalid",
        "Invalid access token"
      );
    }

    const decoded = decode<JwtPayload>(payload);
    if (decoded.exp <= Math.floor(Date.now() / 1000)) {
      throw new ApplicationError(
        "unauthorized",
        "auth.access_token_expired",
        "Access token expired"
      );
    }

    return {
      sub: decoded.sub,
      role: decoded.role,
      email: decoded.email
    };
  }

  private signPart(input: string): string {
    return createHmac("sha256", this.secret).update(input).digest("base64url");
  }
}
