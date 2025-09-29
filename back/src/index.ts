import cors from "cors";
import express from "express";
import { config } from "./config";
import { exchangeGoogleCode, refreshGoogleToken } from "./googleService";
import { exchangeOutlookCode, refreshOutlookToken } from "./outlookService";
import { calendarAccountRepository } from "./repositories/calendarAccountRepository";
import { normalizeHexColor } from "./utils/colors";
import { decodeIdTokenPayload } from "./utils/jwt";
const app = express();
app.use(cors());
app.use(express.json());
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/oauth/config", (_req, res) => {
  res.json({
    google: {
      clientId: config.google.clientId || null,
    },
    microsoft: {
      clientId: config.microsoft.clientId || null,
      defaultTenant: config.microsoft.tenantId || null,
      organizationsTenant: config.microsoft.organizationsTenant || null,
      scopes: config.microsoft.scopes,
      redirectUris: config.microsoft.redirectUris,
      allowedTenants: config.microsoft.allowedTenants,
    },
  });
});
type OAuthExchangeRequest = {
  code?: string;
  redirectUri?: string;
  codeVerifier?: string;
  sessionKey?: string;
  tenantId?: string;
  scopes?: string[];
  color?: string;
  label?: string;
  email?: string;
};
type CalendarAccountDto = {
  id: string;
  provider: "google" | "outlook" | "ics";
  email: string;
  displayName: string | null;
  color: string;
  scope: string | null;
  tenantId: string | null;
  externalId: string | null;
  icsUrl: string | null;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
};
const toAccountDto = (record: Awaited<ReturnType<typeof calendarAccountRepository.findById>>): CalendarAccountDto => {
  if (!record) {
    throw new Error("Account record not found");
  }
  return {
    id: record.id,
    provider: record.provider,
    email: record.email,
    displayName: record.display_name,
    color: record.color,
    scope: record.scope,
    tenantId: record.tenant_id,
    externalId: record.external_id,
    icsUrl: record.ics_url,
    readOnly: record.provider === "ics",
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
};
const computeExpiresAt = (expiresIn?: number | null) => {
  if (!expiresIn || Number.isNaN(Number(expiresIn))) {
    return null;
  }
  return new Date(Date.now() + Number(expiresIn) * 1000);
};
type GoogleIdPayload = {
  email?: string;
  name?: string;
  sub?: string;
};
type OutlookIdPayload = {
  preferred_username?: string;
  email?: string;
  name?: string;
  unique_name?: string;
  oid?: string;
};
const resolveEmail = (candidate?: string | null, fallback?: string | null) => {
  const value = candidate ?? fallback ?? "";
  return value.trim().toLowerCase() || null;
};
app.post("/oauth/google/exchange", async (req, res) => {
  const { code, redirectUri, sessionKey, codeVerifier, color, label, email } = req.body as OAuthExchangeRequest;
  if (!code || !redirectUri) {
    res.status(400).json({ error: "code and redirectUri are required" });
    return;
  }
  try {
    const tokens = await exchangeGoogleCode({ code, redirectUri, codeVerifier });
    const payload = decodeIdTokenPayload<GoogleIdPayload>(tokens.id_token);
    const accountEmail = resolveEmail(payload?.email, email);
    if (!accountEmail) {
      res.status(400).json({ error: "email_not_available", message: "Google nao retornou o email da conta." });
      return;
    }
    const normalizedColor = normalizeHexColor(color ?? "#2a9d8f");
    const expiresAt = computeExpiresAt(tokens.expires_in);
    const account = await calendarAccountRepository.upsert({
      provider: "google",
      email: accountEmail,
      displayName: label ?? payload?.name ?? null,
      color: normalizedColor,
      scope: tokens.scope ?? null,
      externalId: payload?.sub ?? null,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
      refreshToken: tokens.refresh_token ?? null,
      rawPayload: tokens,
    });
    const dto = toAccountDto(account);
    res.json({
      account: dto,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        tokenType: tokens.token_type,
        idToken: tokens.id_token,
        storedUnder: sessionKey ?? dto.id,
      },
    });
  } catch (error: any) {
    const status = error?.response?.status ?? 500;
    const data = error?.response?.data ?? { message: error?.message ?? "exchange failed" };
    console.error("[route] google exchange failed", { status, data });
    res.status(status).json({ error: "google_exchange_failed", details: data });
  }
});
app.post("/oauth/outlook/exchange", async (req, res) => {
  const { code, redirectUri, sessionKey, codeVerifier, tenantId, scopes, color, label, email } =
    req.body as OAuthExchangeRequest;
  if (!code || !redirectUri) {
    res.status(400).json({ error: "code and redirectUri are required" });
    return;
  }
  try {
    const tokens = await exchangeOutlookCode({ code, redirectUri, codeVerifier, tenantId, scopes });
    const payload = decodeIdTokenPayload<OutlookIdPayload>(tokens.id_token);
    const accountEmail =
      resolveEmail(payload?.preferred_username ?? payload?.email ?? payload?.unique_name ?? null, email) ?? email;
    if (!accountEmail) {
      res.status(400).json({ error: "email_not_available", message: "Microsoft nao retornou o email da conta." });
      return;
    }
    const normalizedColor = normalizeHexColor(color ?? "#2a9d8f");
    const expiresAt = computeExpiresAt(tokens.expires_in);
    const resolvedTenant = tokens.tenantId ?? tenantId ?? config.microsoft.tenantId;
    const account = await calendarAccountRepository.upsert({
      provider: "outlook",
      email: accountEmail,
      displayName: label ?? payload?.name ?? null,
      color: normalizedColor,
      scope: tokens.scope ?? null,
      tenantId: resolvedTenant,
      externalId: payload?.oid ?? null,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
      refreshToken: tokens.refresh_token ?? null,
      rawPayload: tokens,
    });
    const dto = toAccountDto(account);
    res.json({
      account: dto,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        tokenType: tokens.token_type,
        idToken: tokens.id_token,
        tenantId: resolvedTenant,
        storedUnder: sessionKey ?? dto.id,
      },
    });
  } catch (error: any) {
    const status = error?.response?.status ?? 500;
    const data = error?.response?.data ?? { message: error?.message ?? "exchange failed" };
    console.error("[route] outlook exchange failed", { status, data });
    res.status(status).json({ error: "outlook_exchange_failed", details: data });
  }
});
app.post("/accounts/ics", async (req, res) => {
  const { url, color, label } = req.body as { url?: string; color?: string; label?: string };

  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "url_required", message: "Informe o link ICS que deseja importar." });
    return;
  }

  let normalizedUrl = url.trim();
  if (normalizedUrl.startsWith("webcal://")) {
    normalizedUrl = `https://${normalizedUrl.slice("webcal://".length)}`;
  }

  try {
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid_protocol");
    }
    normalizedUrl = parsed.toString();
  } catch {
    res.status(400).json({ error: "invalid_url", message: "O link ICS informado não é válido." });
    return;
  }

  const normalizedColor = normalizeHexColor(color ?? "#2a9d8f");
  const displayName = typeof label === "string" && label.trim() ? label.trim() : null;

  try {
    const account = await calendarAccountRepository.upsert({
      provider: "ics",
      email: normalizedUrl,
      displayName,
      color: normalizedColor,
      scope: null,
      externalId: normalizedUrl,
      accessToken: null,
      accessTokenExpiresAt: null,
      refreshToken: null,
      icsUrl: normalizedUrl,
      rawPayload: { url: normalizedUrl, label: displayName ?? undefined },
    });

    res.status(200).json({ account: toAccountDto(account) });
  } catch (error) {
    console.error("[route] falha ao registrar conta ICS", error);
    res.status(500).json({ error: "ics_upsert_failed" });
  }
});
app.get("/accounts", async (_req, res) => {
  const records = await calendarAccountRepository.list();
  const payload = records.map((record) => toAccountDto(record));
  res.json(payload);
});
app.delete("/accounts/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await calendarAccountRepository.findById(id);
  if (!existing) {
    res.status(404).json({ error: "account_not_found" });
    return;
  }
  await calendarAccountRepository.remove(id);
  res.status(204).send();
});
app.patch("/accounts/:id/color", async (req, res) => {
  const { id } = req.params;
  const { color } = req.body as { color?: string };
  if (!color) {
    res.status(400).json({ error: "color_required" });
    return;
  }
  const normalizedColor = normalizeHexColor(color);
  await calendarAccountRepository.updateColor(id, normalizedColor);
  const updated = await calendarAccountRepository.findById(id);
  if (!updated) {
    res.status(404).json({ error: "account_not_found" });
    return;
  }
  res.json(toAccountDto(updated));
});
app.patch("/accounts/:id/tokens", async (req, res) => {
  const { id } = req.params;
  const existing = await calendarAccountRepository.findById(id);
  if (!existing) {
    res.status(404).json({ error: "account_not_found" });
    return;
  }
  const { accessToken, refreshToken, expiresAt, expiresIn, scope, rawPayload } = req.body as {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: string | null;
    expiresIn?: number | null;
    scope?: string | null;
    rawPayload?: Record<string, unknown> | null;
  };
  let computedExpires: Date | null = null;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
    computedExpires = new Date(Date.now() + expiresIn * 1000);
  } else if (expiresAt) {
    const parsed = new Date(expiresAt);
    if (!Number.isNaN(parsed.getTime())) {
      computedExpires = parsed;
    }
  }
  await calendarAccountRepository.updateTokens(id, {
    accessToken: accessToken === undefined ? existing.access_token : accessToken,
    refreshToken: refreshToken === undefined ? existing.refresh_token : refreshToken,
    accessTokenExpiresAt: computedExpires ?? existing.access_token_expires_at,
    scope: scope === undefined ? existing.scope : scope,
    rawPayload: rawPayload === undefined ? existing.raw_payload : rawPayload,
  });
  res.status(204).send();
});
app.post("/accounts/:id/refresh", async (req, res) => {
  const { id } = req.params;
  const existing = await calendarAccountRepository.findById(id);
  if (!existing) {
    res.status(404).json({ error: "account_not_found" });
    return;
  }

  if (!existing.refresh_token) {
    res.status(400).json({ error: "refresh_token_missing" });
    return;
  }

  try {
    if (existing.provider === "google") {
      const tokens = await refreshGoogleToken(existing.refresh_token);
      const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
      await calendarAccountRepository.updateTokens(id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? existing.refresh_token,
        accessTokenExpiresAt: expiresAt,
        scope: tokens.scope ?? existing.scope,
        rawPayload: tokens,
      });
      res.json({
        provider: existing.provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? existing.refresh_token,
        expiresIn: tokens.expires_in,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        scope: tokens.scope ?? existing.scope,
      });
      return;
    }

    if (existing.provider === "outlook") {
      const tokens = await refreshOutlookToken({
        refreshToken: existing.refresh_token,
        tenantId: existing.tenant_id,
        scopes: existing.scope ? existing.scope.split(" ") : undefined,
      });
      const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
      await calendarAccountRepository.updateTokens(id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? existing.refresh_token,
        accessTokenExpiresAt: expiresAt,
        scope: tokens.scope ?? existing.scope,
        rawPayload: tokens,
      });
      res.json({
        provider: existing.provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? existing.refresh_token,
        expiresIn: tokens.expires_in,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        scope: tokens.scope ?? existing.scope,
        tenantId: tokens.tenantId ?? existing.tenant_id,
      });
      return;
    }

    res.status(400).json({ error: "provider_not_supported" });
  } catch (error: any) {
    const status = error?.response?.status ?? 500;
    const data = error?.response?.data ?? { message: error?.message ?? "refresh_failed" };
    console.error("[route] refresh token failed", { status, data });
    res.status(status).json({ error: "refresh_failed", details: data });
  }
});
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[unhandled]", err);
  res.status(500).json({ error: "internal_error" });
});
const startServer = (port: number, retriesRemaining: number): void => {
  const server = app.listen(port, () => {
    console.log(`[server] listening on port ${port}`);
    console.log('[server] google client secret length', config.google.clientSecret?.length ?? 0);
    console.log('[server] microsoft client secret length', config.microsoft.clientSecret?.length ?? 0);
  });
  server.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && retriesRemaining > 0) {
      console.warn(`[server] port ${port} is in use, trying port ${port + 1}`);
      setTimeout(() => startServer(port + 1, retriesRemaining - 1), 250);
      return;
    }
    console.error("[server] failed to start", error);
    process.exit(1);
  });
};
const retryLimit = config.portRetryLimit;
startServer(config.port, retryLimit);


