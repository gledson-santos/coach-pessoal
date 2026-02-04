import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildApiUrl } from "../config/api";

const TOKEN_STORAGE_KEY = "auth_tokens";
const TENANT_STORAGE_KEY = "tenant_id";

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export const getTenantId = async () => {
  return AsyncStorage.getItem(TENANT_STORAGE_KEY);
};

export const setTenantId = async (tenantId: string) => {
  await AsyncStorage.setItem(TENANT_STORAGE_KEY, tenantId);
};

export const clearTenantId = async () => {
  await AsyncStorage.removeItem(TENANT_STORAGE_KEY);
};

export const getStoredTokens = async (): Promise<AuthTokens | null> => {
  const raw = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
};

export const storeTokens = async (tokens: AuthTokens) => {
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
};

export const clearTokens = async () => {
  await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
};

const request = async <T>(
  path: string,
  options: RequestInit & { tenantId: string }
): Promise<T> => {
  const { tenantId, ...rest } = options;
  const response = await fetch(buildApiUrl(path), {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-ID": tenantId,
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

export const login = async (tenantId: string, email: string, password: string) => {
  return request<AuthTokens>("/auth/login", {
    method: "POST",
    tenantId,
    body: JSON.stringify({ email, password }),
  });
};

export const register = async (tenantId: string, email: string, password: string) => {
  return request<AuthTokens>("/auth/register", {
    method: "POST",
    tenantId,
    body: JSON.stringify({ email, password }),
  });
};

export const refreshSession = async (tenantId: string, refreshToken: string) => {
  return request<AuthTokens>("/auth/refresh", {
    method: "POST",
    tenantId,
    body: JSON.stringify({ refreshToken }),
  });
};

export const requestPasswordReset = async (tenantId: string, email: string) => {
  return request<{ status: string }>("/auth/password/request-reset", {
    method: "POST",
    tenantId,
    body: JSON.stringify({ email }),
  });
};

export const resetPassword = async (tenantId: string, token: string, newPassword: string) => {
  await request<void>("/auth/password/reset", {
    method: "POST",
    tenantId,
    body: JSON.stringify({ token, newPassword }),
  });
};

export const logout = async (tenantId: string, accessToken: string) => {
  await request<void>("/auth/logout", {
    method: "POST",
    tenantId,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await clearTokens();
};

export const fetchProviderStatus = async (tenantId: string) => {
  return request<{ providers: { provider: string; configured: boolean; clientId: string | null }[] }>(
    "/auth/providers",
    {
      method: "GET",
      tenantId,
    }
  );
};

export const startSocialLogin = async (tenantId: string, provider: string, redirectUri: string) => {
  return request<{ authUrl: string }>(`/auth/oauth/${provider}/start?redirectUri=${encodeURIComponent(redirectUri)}`, {
    method: "GET",
    tenantId,
  });
};

export const completeSocialLogin = async (tenantId: string, code: string) => {
  return request<AuthTokens>("/auth/oauth/complete", {
    method: "POST",
    tenantId,
    body: JSON.stringify({ code }),
  });
};
