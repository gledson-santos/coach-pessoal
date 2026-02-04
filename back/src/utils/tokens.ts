import crypto from "crypto";
import { config } from "../config";

type JwtPayload = {
  sub: string;
  tenantId: string;
  email: string;
  isAdmin: boolean;
  exp: number;
  iat: number;
};

const base64Url = (input: Buffer | string) => {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
};

const sign = (data: string) => {
  return base64Url(crypto.createHmac("sha256", config.auth.jwtSecret).update(data).digest());
};

export const createAccessToken = (payload: Omit<JwtPayload, "exp" | "iat">, ttlSeconds: number) => {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify({ ...payload, iat, exp }));
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
};

export const verifyAccessToken = (token: string): JwtPayload | null => {
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) {
    return null;
  }
  const expected = sign(`${header}.${body}`);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!decoded.exp || typeof decoded.exp !== "number") {
      return null;
    }
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded as JwtPayload;
  } catch {
    return null;
  }
};
