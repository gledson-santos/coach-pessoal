import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const incomingId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined;
  const requestId = incomingId && incomingId.trim() ? incomingId.trim() : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};
