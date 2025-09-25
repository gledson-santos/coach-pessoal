const baseScopes = (process.env.EXPO_PUBLIC_MICROSOFT_SCOPES ?? "").split(/[\s,]+/)
  .map((scope) => scope.trim())
  .filter(Boolean);
const requiredScopes = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "https://graph.microsoft.com/Calendars.ReadWrite",
];

export const OUTLOOK_OAUTH_CONFIG = {
  /**
   * Client ID registrado no Azure (app multi-plataforma).
   */
  clientId: process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID ?? "",
  /**
   * Tenant padrao utilizado na autenticacao (common = contas pessoais ou corporativas).
   */
  defaultTenant: process.env.EXPO_PUBLIC_MICROSOFT_DEFAULT_TENANT ?? "common",
  /**
   * Tenant utilizado para contas corporativas do Microsoft 365 (organizations por padrao).
   */
  organizationsTenant:
    process.env.EXPO_PUBLIC_MICROSOFT_ORGANIZATIONS_TENANT ?? "organizations",
  /**
   * Escopos solicitados no consentimento.
   */
  scopes: Array.from(new Set([...baseScopes, ...requiredScopes])),
};
