"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const googleService_1 = require("./googleService");
const outlookService_1 = require("./outlookService");
const calendarAccountRepository_1 = require("./repositories/calendarAccountRepository");
const colors_1 = require("./utils/colors");
const jwt_1 = require("./utils/jwt");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});
const toAccountDto = (record) => {
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
        createdAt: record.created_at.toISOString(),
        updatedAt: record.updated_at.toISOString(),
    };
};
const computeExpiresAt = (expiresIn) => {
    if (!expiresIn || Number.isNaN(Number(expiresIn))) {
        return null;
    }
    return new Date(Date.now() + Number(expiresIn) * 1000);
};
const resolveEmail = (candidate, fallback) => {
    const value = candidate ?? fallback ?? "";
    return value.trim().toLowerCase() || null;
};
app.post("/oauth/google/exchange", async (req, res) => {
    const { code, redirectUri, sessionKey, codeVerifier, color, label, email } = req.body;
    if (!code || !redirectUri) {
        res.status(400).json({ error: "code and redirectUri are required" });
        return;
    }
    try {
        const tokens = await (0, googleService_1.exchangeGoogleCode)({ code, redirectUri, codeVerifier });
        const payload = (0, jwt_1.decodeIdTokenPayload)(tokens.id_token);
        const accountEmail = resolveEmail(payload?.email, email);
        if (!accountEmail) {
            res.status(400).json({ error: "email_not_available", message: "Google nao retornou o email da conta." });
            return;
        }
        const normalizedColor = (0, colors_1.normalizeHexColor)(color ?? "#2a9d8f");
        const expiresAt = computeExpiresAt(tokens.expires_in);
        const account = await calendarAccountRepository_1.calendarAccountRepository.upsert({
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
    }
    catch (error) {
        const status = error?.response?.status ?? 500;
        const data = error?.response?.data ?? { message: error?.message ?? "exchange failed" };
        console.error("[route] google exchange failed", { status, data });
        res.status(status).json({ error: "google_exchange_failed", details: data });
    }
});
app.post("/oauth/outlook/exchange", async (req, res) => {
    const { code, redirectUri, sessionKey, codeVerifier, tenantId, scopes, color, label, email } = req.body;
    if (!code || !redirectUri) {
        res.status(400).json({ error: "code and redirectUri are required" });
        return;
    }
    try {
        const tokens = await (0, outlookService_1.exchangeOutlookCode)({ code, redirectUri, codeVerifier, tenantId, scopes });
        const payload = (0, jwt_1.decodeIdTokenPayload)(tokens.id_token);
        const accountEmail = resolveEmail(payload?.preferred_username ?? payload?.email ?? payload?.unique_name ?? null, email) ?? email;
        if (!accountEmail) {
            res.status(400).json({ error: "email_not_available", message: "Microsoft nao retornou o email da conta." });
            return;
        }
        const normalizedColor = (0, colors_1.normalizeHexColor)(color ?? "#2a9d8f");
        const expiresAt = computeExpiresAt(tokens.expires_in);
        const resolvedTenant = tokens.tenantId ?? tenantId ?? config_1.config.microsoft.tenantId;
        const account = await calendarAccountRepository_1.calendarAccountRepository.upsert({
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
    }
    catch (error) {
        const status = error?.response?.status ?? 500;
        const data = error?.response?.data ?? { message: error?.message ?? "exchange failed" };
        console.error("[route] outlook exchange failed", { status, data });
        res.status(status).json({ error: "outlook_exchange_failed", details: data });
    }
});
app.get("/accounts", async (_req, res) => {
    const records = await calendarAccountRepository_1.calendarAccountRepository.list();
    const payload = records.map((record) => toAccountDto(record));
    res.json(payload);
});
app.delete("/accounts/:id", async (req, res) => {
    const { id } = req.params;
    const existing = await calendarAccountRepository_1.calendarAccountRepository.findById(id);
    if (!existing) {
        res.status(404).json({ error: "account_not_found" });
        return;
    }
    await calendarAccountRepository_1.calendarAccountRepository.remove(id);
    res.status(204).send();
});
app.patch("/accounts/:id/color", async (req, res) => {
    const { id } = req.params;
    const { color } = req.body;
    if (!color) {
        res.status(400).json({ error: "color_required" });
        return;
    }
    const normalizedColor = (0, colors_1.normalizeHexColor)(color);
    await calendarAccountRepository_1.calendarAccountRepository.updateColor(id, normalizedColor);
    const updated = await calendarAccountRepository_1.calendarAccountRepository.findById(id);
    if (!updated) {
        res.status(404).json({ error: "account_not_found" });
        return;
    }
    res.json(toAccountDto(updated));
});
app.use((err, _req, res, _next) => {
    console.error("[unhandled]", err);
    res.status(500).json({ error: "internal_error" });
});
const startServer = (port, retriesRemaining) => {
    const server = app.listen(port, () => {
        console.log(`[server] listening on port ${port}`);
        console.log('[server] google client secret length', config_1.config.google.clientSecret?.length ?? 0);
        console.log('[server] microsoft client secret length', config_1.config.microsoft.clientSecret?.length ?? 0);
    });
    server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && retriesRemaining > 0) {
            console.warn(`[server] port ${port} is in use, trying port ${port + 1}`);
            setTimeout(() => startServer(port + 1, retriesRemaining - 1), 250);
            return;
        }
        console.error("[server] failed to start", error);
        process.exit(1);
    });
};
const retryLimit = config_1.config.portRetryLimit;
startServer(config_1.config.port, retryLimit);
