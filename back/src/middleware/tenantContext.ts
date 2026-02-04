import { Request, Response, NextFunction } from "express";

declare module "express-serve-static-core" {
  interface Request {
    tenantId?: string;
  }
}

export const requireTenant = (req: Request, res: Response, next: NextFunction) => {
  const tenantHeader = req.headers["x-tenant-id"];
  const tenantId = typeof tenantHeader === "string" ? tenantHeader.trim() : "";
  if (!tenantId) {
    res.status(400).json({ error: "tenant_required", message: "Tenant ID ausente." });
    return;
  }
  req.tenantId = tenantId;
  next();
};
