const parseScopes = (scopes: string[] | undefined) => {
  if (!Array.isArray(scopes)) {
    return [];
  }
  return scopes
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter(Boolean);
};

const parseRedirectUris = (uris: string[] | undefined) => {
  if (!Array.isArray(uris)) {
    return [];
  }
  return uris
    .map((uri) => (typeof uri === "string" ? uri.trim() : ""))
    .filter(Boolean);
};

const fromEnv = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const requiredScopes = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "https://graph.microsoft.com/Calendars.ReadWrite",
];

const sanitizeTenant = (value: string | null | undefined, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
};

const mergeScopes = (...lists: (string[] | undefined)[]) => {
  const combined = [
    ...requiredScopes,
    ...fromEnv(process.env.EXPO_PUBLIC_MICROSOFT_SCOPES),
    ...lists.flatMap((list) => parseScopes(list)),
  ];
  return Array.from(new Set(combined));
};

const mergeRedirectUris = (...lists: (string[] | undefined)[]) => {
  const combined = [
    ...fromEnv(process.env.EXPO_PUBLIC_MICROSOFT_REDIRECT_URIS),
    ...lists.flatMap((list) => parseRedirectUris(list)),
  ];
  return Array.from(new Set(combined));
};

export type OutlookOAuthConfig = {
  clientId: string;
  defaultTenant: string;
  organizationsTenant: string;
  scopes: string[];
  redirectUris: string[];
};

const initialConfig: OutlookOAuthConfig = {
  clientId: process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID ?? "",
  defaultTenant: sanitizeTenant(process.env.EXPO_PUBLIC_MICROSOFT_DEFAULT_TENANT, "common"),
  organizationsTenant: sanitizeTenant(
    process.env.EXPO_PUBLIC_MICROSOFT_ORGANIZATIONS_TENANT,
    "organizations"
  ),
  scopes: mergeScopes(),
  redirectUris: mergeRedirectUris(),
};

let currentConfig: OutlookOAuthConfig = { ...initialConfig };

export const getOutlookOAuthConfig = (): OutlookOAuthConfig => currentConfig;

export const updateOutlookOAuthConfig = (
  overrides: Partial<OutlookOAuthConfig>
): OutlookOAuthConfig => {
  currentConfig = {
    clientId:
      typeof overrides.clientId === "string" ? overrides.clientId : currentConfig.clientId,
    defaultTenant: sanitizeTenant(overrides.defaultTenant, currentConfig.defaultTenant),
    organizationsTenant: sanitizeTenant(
      overrides.organizationsTenant,
      currentConfig.organizationsTenant
    ),
    scopes: mergeScopes(currentConfig.scopes, overrides.scopes),
    redirectUris: mergeRedirectUris(currentConfig.redirectUris, overrides.redirectUris),
  };
  return currentConfig;
};

export const resetOutlookOAuthConfig = (): OutlookOAuthConfig => {
  currentConfig = { ...initialConfig };
  return currentConfig;
};
