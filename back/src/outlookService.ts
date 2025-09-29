import axios from "axios";
import { config } from "./config";

type ExchangeParams = {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  tenantId?: string;
  scopes?: string[];
};

export type OutlookTokenResponse = {
  token_type?: string;
  scope?: string;
  expires_in?: number;
  ext_expires_in?: number;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  tenantId?: string;
  [key: string]: unknown;
};

const sanitizeTenantId = (value: string | null | undefined) => {
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

const allowedTenantSet = new Set(
  config.microsoft.allowedTenants.map((tenant) => tenant.toLowerCase())
);

const isTenantAllowed = (tenantId: string) => {
  if (allowedTenantSet.size === 0) {
    return true;
  }
  return allowedTenantSet.has(tenantId.toLowerCase());
};

const getTokenEndpoint = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

const isRedirectAllowed = (redirectUri: string) => {
  if (config.microsoft.redirectUris.length === 0) {
    return true;
  }
  return config.microsoft.redirectUris.some((value) => value === redirectUri);
};

const ensureScopes = (scopes: string[] | undefined) => {
  const combined = [
    ...config.microsoft.scopes,
    ...(Array.isArray(scopes) ? scopes : []),
    "offline_access",
    "Calendars.Read",
    "openid",
    "profile",
    "email",
  ];

  return Array.from(
    new Set(
      combined
        .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
        .filter(Boolean)
    )
  );
};

export const exchangeOutlookCode = async ({
  code,
  redirectUri,
  codeVerifier,
  tenantId,
  scopes,
}: ExchangeParams) => {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
    throw new Error(
      "Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET."
    );
  }

  if (!isRedirectAllowed(redirectUri)) {
    throw new Error(
      `redirect_uri "${redirectUri}" is not allowed. Configure MICROSOFT_REDIRECT_URIS.`
    );
  }

  const normalizedTenant = sanitizeTenantId(tenantId);
  const resolvedTenant = normalizedTenant ?? config.microsoft.tenantId.toLowerCase();

  if (!isTenantAllowed(resolvedTenant)) {
    throw new Error(
      `tenant "${resolvedTenant}" is not allowed. Configure MICROSOFT_ALLOWED_TENANTS.`
    );
  }

  const payload = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
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

  const response = await axios.post<OutlookTokenResponse>(
    getTokenEndpoint(resolvedTenant),
    payload.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return {
    ...response.data,
    tenantId: response.data.tenantId ?? resolvedTenant,
  };
};

export const refreshOutlookToken = async ({
  refreshToken,
  tenantId,
  scopes,
}: {
  refreshToken: string;
  tenantId?: string | null;
  scopes?: string[];
}) => {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
    throw new Error("Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.");
  }

  const normalizedTenant = sanitizeTenantId(tenantId) ?? config.microsoft.tenantId.toLowerCase();
  if (!isTenantAllowed(normalizedTenant)) {
    throw new Error(`tenant "${normalizedTenant}" is not allowed. Configure MICROSOFT_ALLOWED_TENANTS.`);
  }

  const finalScopes = ensureScopes(scopes);

  const payload = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  if (finalScopes.length > 0) {
    payload.append("scope", finalScopes.join(" "));
  }

  const response = await axios.post<OutlookTokenResponse>(
    getTokenEndpoint(normalizedTenant),
    payload.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return {
    ...response.data,
    tenantId: response.data.tenantId ?? normalizedTenant,
  };
};
