import crypto from "node:crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS)
    .toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  const attempt = crypto
    .scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS)
    .toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(attempt, "hex")
  );
}
