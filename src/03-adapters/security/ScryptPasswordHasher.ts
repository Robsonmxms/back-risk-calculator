import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { PasswordHasher } from "../../02-application/ports/security";

const scrypt = promisify(scryptCallback);

export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plainTextPassword: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scrypt(plainTextPassword, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
  }

  async verify(plainTextPassword: string, storedHash?: string): Promise<boolean> {
    if (!storedHash) {
      return false;
    }

    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) {
      return false;
    }

    const expected = Buffer.from(hash, "hex");
    const actual = (await scrypt(plainTextPassword, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
