import { buildApiUrl } from "../config/api";
import {
  getOutlookOAuthConfig,
  OutlookOAuthConfig,
  updateOutlookOAuthConfig,
} from "../config/outlookOAuth";

type OAuthConfigResponse = {
  microsoft?: {
    clientId?: string | null;
    defaultTenant?: string | null;
    organizationsTenant?: string | null;
    scopes?: string[] | null;
  } | null;
};

const extractMicrosoftOverrides = (
  payload: OAuthConfigResponse["microsoft"]
): Partial<OutlookOAuthConfig> => {
  if (!payload) {
    return {};
  }

  const overrides: Partial<OutlookOAuthConfig> = {};

  if (typeof payload.clientId === "string") {
    overrides.clientId = payload.clientId;
  }

  if (typeof payload.defaultTenant === "string") {
    overrides.defaultTenant = payload.defaultTenant;
  }

  if (typeof payload.organizationsTenant === "string") {
    overrides.organizationsTenant = payload.organizationsTenant;
  }

  if (Array.isArray(payload.scopes)) {
    overrides.scopes = payload.scopes
      .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
      .filter((scope): scope is string => Boolean(scope));
  }

  return overrides;
};

export const loadRemoteOAuthConfig = async (): Promise<{
  microsoft: OutlookOAuthConfig | null;
}> => {
  const response = await fetch(buildApiUrl("/oauth/config"));
  if (!response.ok) {
    const message = await response.text().catch(() => "Nao foi possivel carregar configuracao OAuth");
    throw new Error(message || "Nao foi possivel carregar configuracao OAuth");
  }

  const data = (await response.json()) as OAuthConfigResponse;
  if (data?.microsoft) {
    const overrides = extractMicrosoftOverrides(data.microsoft);
    const config = updateOutlookOAuthConfig(overrides);
    return { microsoft: config };
  }

  return { microsoft: getOutlookOAuthConfig() };
};
