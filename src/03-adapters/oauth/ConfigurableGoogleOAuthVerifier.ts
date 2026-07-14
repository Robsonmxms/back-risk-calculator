import { ApplicationError } from "../../02-application/errors/application-error";
import {
  GoogleOAuthInput,
  GoogleOAuthVerifier,
  VerifiedGoogleIdentity
} from "../../02-application/ports/security";
import { AppConfig } from "../../04-infra/config/env";

export class ConfigurableGoogleOAuthVerifier implements GoogleOAuthVerifier {
  constructor(private readonly config: AppConfig) {}

  async verify(input: GoogleOAuthInput): Promise<VerifiedGoogleIdentity> {
    const credential = input.idToken ?? input.code;

    if (this.config.googleOAuthMockTokens && credential?.startsWith("mock-google:")) {
      const email = credential.replace("mock-google:", "").trim().toLowerCase();
      if (!email.includes("@")) {
        throw new ApplicationError("unauthorized", "auth.google_invalid", "Invalid Google credential");
      }

      return {
        subject: `mock:${email}`,
        email,
        name: email.split("@")[0]
      };
    }

    throw new ApplicationError(
      "unavailable",
      "auth.google_unavailable",
      "Google authentication is not configured"
    );
  }
}
