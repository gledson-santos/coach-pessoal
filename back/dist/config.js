"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const parseRedirectUris = (value) => {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
};
const parseScopes = (value) => {
    if (!value) {
        return [];
    }
    return value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
};
const parseList = (value) => {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
};
const parseInteger = (value, fallback, options = {}) => {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    if (options.min !== undefined && parsed < options.min) {
        return fallback;
    }
    if (options.max !== undefined && parsed > options.max) {
        return fallback;
    }
    return parsed;
};
exports.config = {
    port: parseInteger(process.env.PORT, 4000, { min: 1, max: 65535 }),
    portRetryLimit: parseInteger(process.env.PORT_RETRY_LIMIT, 5, { min: 0 }),
    database: {
        host: process.env.DB_HOST ?? 'localhost',
        port: parseInteger(process.env.DB_PORT, 3306, { min: 1, max: 65535 }),
        user: process.env.DB_USER ?? 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME ?? 'coach',
        connectionLimit: parseInteger(process.env.DB_POOL_LIMIT, 10, { min: 1, max: 100 }),
    },
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirectUris: parseRedirectUris(process.env.GOOGLE_REDIRECT_URIS ?? ""),
    },
    microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
        tenantId: (process.env.MICROSOFT_TENANT_ID ?? "common").trim() || "common",
        redirectUris: parseRedirectUris(process.env.MICROSOFT_REDIRECT_URIS ?? ""),
        scopes: parseScopes(process.env.MICROSOFT_SCOPES ?? ""),
        allowedTenants: parseList(process.env.MICROSOFT_ALLOWED_TENANTS ?? ""),
    },
};
if (!exports.config.google.clientId || !exports.config.google.clientSecret) {
    // eslint-disable-next-line no-console
    console.warn("[config] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. OAuth exchange will fail until configured.");
}
if (!exports.config.microsoft.clientId || !exports.config.microsoft.clientSecret) {
    console.warn("[config] MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not set. Outlook exchange will fail until configured.");
}
