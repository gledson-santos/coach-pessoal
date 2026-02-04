import axios from "axios";
import { decryptSecret } from "../utils/crypto";

export type OAuthProvider = "google" | "microsoft" | "facebook";

export type TenantOAuthConfig = {
  clientId: string;
  clientSecretEncrypted: string;
  redirectUris: string[];
  extra: Record<string, unknown> | null;
};

export type OAuthProfile = {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

const getSecret = (config: TenantOAuthConfig) => decryptSecret(config.clientSecretEncrypted);

export const buildAuthUrl = (provider: OAuthProvider, config: TenantOAuthConfig, redirectUri: string, state: string) => {
  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  if (provider === "microsoft") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: "openid email profile offline_access",
      state,
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "email,public_profile",
    state,
  });
  return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
};

export const exchangeCodeForProfile = async (
  provider: OAuthProvider,
  config: TenantOAuthConfig,
  code: string,
  redirectUri: string
): Promise<OAuthProfile> => {
  if (provider === "google") {
    const tokenResponse = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: getSecret(config),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "content-type": "application/x-www-form-urlencoded" } }
    );
    const accessToken = tokenResponse.data.access_token as string;
    const userinfo = await axios.get("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return {
      providerUserId: userinfo.data.sub,
      email: userinfo.data.email ?? null,
      emailVerified: Boolean(userinfo.data.email_verified),
      name: userinfo.data.name ?? null,
    };
  }
  if (provider === "microsoft") {
    const tokenResponse = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: getSecret(config),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "openid email profile offline_access",
      }).toString(),
      { headers: { "content-type": "application/x-www-form-urlencoded" } }
    );
    const accessToken = tokenResponse.data.access_token as string;
    const profileResponse = await axios.get("https://graph.microsoft.com/v1.0/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return {
      providerUserId: profileResponse.data.id,
      email: profileResponse.data.mail ?? profileResponse.data.userPrincipalName ?? null,
      emailVerified: true,
      name: profileResponse.data.displayName ?? null,
    };
  }
  const tokenResponse = await axios.get("https://graph.facebook.com/v18.0/oauth/access_token", {
    params: {
      client_id: config.clientId,
      client_secret: getSecret(config),
      redirect_uri: redirectUri,
      code,
    },
  });
  const accessToken = tokenResponse.data.access_token as string;
  const profileResponse = await axios.get("https://graph.facebook.com/me", {
    params: { fields: "id,name,email", access_token: accessToken },
  });
  return {
    providerUserId: profileResponse.data.id,
    email: profileResponse.data.email ?? null,
    emailVerified: Boolean(profileResponse.data.email),
    name: profileResponse.data.name ?? null,
  };
};
