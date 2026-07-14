import { AccessTokenClaims } from "../../01-domain/auth/actor";

export interface PasswordHasher {
  hash(plainTextPassword: string): Promise<string>;
  verify(plainTextPassword: string, storedHash?: string): Promise<boolean>;
}

export interface AccessTokenService {
  sign(claims: AccessTokenClaims): string;
  verify(token: string): AccessTokenClaims;
}

export interface PlainRefreshToken {
  token: string;
  tokenHash: string;
}

export interface RefreshTokenGenerator {
  generate(): PlainRefreshToken;
  hash(token: string): string;
}

export interface GoogleOAuthInput {
  idToken?: string;
  code?: string;
  redirectUri?: string;
}

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  name: string;
}

export interface GoogleOAuthVerifier {
  verify(input: GoogleOAuthInput): Promise<VerifiedGoogleIdentity>;
}
