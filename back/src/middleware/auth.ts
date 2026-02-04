import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/tokens";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      tenantId: string;
      email: string;
      isAdmin: boolean;
    };
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = {
    id: payload.sub,
    tenantId: payload.tenantId,
    email: payload.email,
    isAdmin: payload.isAdmin,
  };
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
};

export const requireTenantMatch = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.tenantId && req.tenantId && req.user.tenantId !== req.tenantId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
};
