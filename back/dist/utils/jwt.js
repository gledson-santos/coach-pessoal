"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeIdTokenPayload = void 0;
const base64UrlDecode = (input) => {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padding);
    return Buffer.from(padded, "base64").toString("utf8");
};
const decodeIdTokenPayload = (idToken) => {
    if (!idToken || typeof idToken !== "string") {
        return null;
    }
    const segments = idToken.split(".");
    if (segments.length < 2) {
        return null;
    }
    try {
        const payloadJson = base64UrlDecode(segments[1]);
        return JSON.parse(payloadJson);
    }
    catch {
        return null;
    }
};
exports.decodeIdTokenPayload = decodeIdTokenPayload;
