import { buildApiUrl } from "../config/api";

type OAuthConfigPayload = {
  provider: string;
  configured: boolean;
  clientId: string | null;
  secretMasked: string | null;
  callbackUri: string | null;
  redirectUris: string[];
};

const request = async <T>(path: string, options: RequestInit & { tenantId: string; token: string }) => {
  const { tenantId, token, ...rest } = options;
  const response = await fetch(buildApiUrl(path), {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-ID": tenantId,
      Authorization: `Bearer ${token}`,
      ...(rest.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Erro ao processar requisicao.");
  }
  return data as T;
};

export const fetchTenantOAuthConfigs = async (tenantId: string, token: string) => {
  return request<OAuthConfigPayload[]>("/tenant/oauth", {
    method: "GET",
    tenantId,
    token,
  });
};

export const updateTenantOAuthConfig = async (
  tenantId: string,
  token: string,
  provider: string,
  payload: { clientId: string; clientSecret: string; callbackUri: string; redirectUris: string[] }
) => {
  return request<OAuthConfigPayload>(`/tenant/oauth/${provider}`, {
    method: "PUT",
    tenantId,
    token,
    body: JSON.stringify(payload),
  });
};
