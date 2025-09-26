import dotenv from "dotenv";

dotenv.config();

const parseRedirectUris = (value: string | undefined) => {
  if (!value) {
    return [];
  }

  const entries = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(entries));
};

const parseScopes = (value: string | undefined) => {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseList = (value: string | undefined) => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};




type IntegerParseOptions = {
  min?: number;
  max?: number;
};

const parseInteger = (
  value: string | undefined,
  fallback: number,
  options: IntegerParseOptions = {}
) => {
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

export const config = {
  port: parseInteger(process.env.PORT, 4000, { min: 1, max: 65535 }),
  portRetryLimit: parseInteger(process.env.PORT_RETRY_LIMIT, 5, { min: 0 }),
  database: {
    host: process.env.DB_HOST ?? "localhost",
    port: parseInteger(process.env.DB_PORT, 3306, { min: 1, max: 65535 }),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "coach",
    connectionLimit: parseInteger(process.env.DB_POOL_LIMIT, 10, { min: 1, max: 100 }),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUris: parseRedirectUris(process.env.GOOGLE_REDIRECT_URIS ?? ""),
  },
  microsoft: (() => {
    const defaultTenant = (process.env.MICROSOFT_TENANT_ID ?? "consumers").trim() || "consumers";
    const organizationsTenant =
      (process.env.MICROSOFT_ORGANIZATIONS_TENANT ?? "organizations").trim() || "organizations";
    const explicitAllowed = parseList(process.env.MICROSOFT_ALLOWED_TENANTS ?? "");
    const allowedTenants =
      explicitAllowed.length > 0
        ? explicitAllowed
        : Array.from(new Set([defaultTenant, organizationsTenant]));

    return {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      tenantId: defaultTenant,
      organizationsTenant,
      redirectUris: parseRedirectUris(process.env.MICROSOFT_REDIRECT_URIS ?? ""),
      scopes: parseScopes(process.env.MICROSOFT_SCOPES ?? ""),
      allowedTenants,
    };
  })(),
};

if (!config.google.clientId || !config.google.clientSecret) {
  // eslint-disable-next-line no-console
  console.warn(
    "[config] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set. OAuth exchange will fail until configured."
  );
}

if (!config.microsoft.clientId || !config.microsoft.clientSecret) {
  console.warn(
    "[config] MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET not set. Outlook exchange will fail until configured."
  );
}
