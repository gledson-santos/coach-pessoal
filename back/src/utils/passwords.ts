import crypto from "crypto";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const COST = 64 * 1024;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

export const hashPassword = (password: string): string => {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });
  return crypto.timingSafeEqual(Buffer.from(hashHex, "hex"), derived);
};
