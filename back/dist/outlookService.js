"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchangeOutlookCode = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const sanitizeTenantId = (value) => {
    if (!value) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) {
        return undefined;
    }
    return trimmed.toLowerCase();
};
const allowedTenantSet = new Set(config_1.config.microsoft.allowedTenants.map((tenant) => tenant.toLowerCase()));
const isTenantAllowed = (tenantId) => {
    if (allowedTenantSet.size === 0) {
        return true;
    }
    return allowedTenantSet.has(tenantId.toLowerCase());
};
const getTokenEndpoint = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const isRedirectAllowed = (redirectUri) => {
    if (config_1.config.microsoft.redirectUris.length === 0) {
        return true;
    }
    return config_1.config.microsoft.redirectUris.some((value) => value === redirectUri);
};
const ensureScopes = (scopes) => {
    const combined = [
        ...config_1.config.microsoft.scopes,
        ...(Array.isArray(scopes) ? scopes : []),
        "offline_access",
        "https://graph.microsoft.com/Calendars.ReadWrite",
        "openid",
        "profile",
        "email",
    ];
    return Array.from(new Set(combined
        .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
        .filter(Boolean)));
};
const exchangeOutlookCode = async ({ code, redirectUri, codeVerifier, tenantId, scopes, }) => {
    if (!config_1.config.microsoft.clientId || !config_1.config.microsoft.clientSecret) {
        throw new Error("Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.");
    }
    if (!isRedirectAllowed(redirectUri)) {
        throw new Error(`redirect_uri "${redirectUri}" is not allowed. Configure MICROSOFT_REDIRECT_URIS.`);
    }
    const normalizedTenant = sanitizeTenantId(tenantId);
    const resolvedTenant = normalizedTenant ?? config_1.config.microsoft.tenantId.toLowerCase();
    if (!isTenantAllowed(resolvedTenant)) {
        throw new Error(`tenant "${resolvedTenant}" is not allowed. Configure MICROSOFT_ALLOWED_TENANTS.`);
    }
    const payload = new URLSearchParams({
        client_id: config_1.config.microsoft.clientId,
        client_secret: config_1.config.microsoft.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
    });
    const finalScopes = ensureScopes(scopes);
    if (finalScopes.length > 0) {
        payload.append("scope", finalScopes.join(" "));
    }
    if (codeVerifier) {
        payload.append("code_verifier", codeVerifier);
    }
    const response = await axios_1.default.post(getTokenEndpoint(resolvedTenant), payload.toString(), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });
    return {
        ...response.data,
        tenantId: response.data.tenantId ?? resolvedTenant,
    };
};
exports.exchangeOutlookCode = exchangeOutlookCode;
