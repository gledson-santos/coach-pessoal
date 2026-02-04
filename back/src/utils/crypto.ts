import crypto from "crypto";
import { config } from "../config";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

const getKey = () => {
  const key = Buffer.from(config.auth.encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error("Invalid encryption key length. Must be 32 bytes (base64).");
  }
  return key;
};

export const encryptSecret = (plainText: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
};

export const decryptSecret = (payload: string): string => {
  const data = Buffer.from(payload, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = data.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
};
