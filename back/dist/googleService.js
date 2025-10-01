"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchangeGoogleCode = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const isRedirectAllowed = (redirectUri) => {
    if (config_1.config.google.redirectUris.length === 0) {
        return true;
    }
    return config_1.config.google.redirectUris.some((value) => value === redirectUri);
};
const exchangeGoogleCode = async ({ code, redirectUri, codeVerifier }) => {
    console.log('[exchange] env client secret present?', Boolean(process.env.GOOGLE_CLIENT_SECRET));
    console.log('[exchange] config client secret length', config_1.config.google.clientSecret?.length ?? 0);
    if (!config_1.config.google.clientId || !config_1.config.google.clientSecret) {
        throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    }
    if (!isRedirectAllowed(redirectUri)) {
        throw new Error(`redirect_uri "${redirectUri}" is not allowed. Configure GOOGLE_REDIRECT_URIS.`);
    }
    const payload = new URLSearchParams({
        client_id: config_1.config.google.clientId,
        client_secret: config_1.config.google.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
    });
    if (codeVerifier) {
        payload.append("code_verifier", codeVerifier);
    }
    const response = await axios_1.default.post(GOOGLE_TOKEN_ENDPOINT, payload.toString(), {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });
    return response.data;
};
exports.exchangeGoogleCode = exchangeGoogleCode;
