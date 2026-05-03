import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const keyLength = 64;
const scryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
} as const;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, keyLength, scryptOptions).toString("base64url");

  return `scrypt$${scryptOptions.N}$${scryptOptions.r}$${scryptOptions.p}$${salt}$${hash}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, n, r, p, salt, expectedHash] = passwordHash.split("$");

  if (algorithm !== "scrypt" || !n || !r || !p || !salt || !expectedHash) {
    return false;
  }

  const hash = scryptSync(password, salt, keyLength, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  }).toString("base64url");

  const hashBuffer = Buffer.from(hash);
  const expectedBuffer = Buffer.from(expectedHash);

  return (
    hashBuffer.length === expectedBuffer.length &&
    timingSafeEqual(hashBuffer, expectedBuffer)
  );
}
