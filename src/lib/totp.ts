import * as OTPAuth from "otpauth";

const ISSUER = "PCHub Store Panel";

export function generateTOTPSecret(): string {
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

export function getTOTPUri(secret: string, email: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

export function verifyTOTPCode(secret: string, code: string): boolean {
  try {
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    // window=2 allows ±60 seconds clock drift (Railway containers can drift more than 30s)
    const delta = totp.validate({ token: code.replace(/\s/g, ""), window: 2 });
    return delta !== null;
  } catch {
    return false;
  }
}
