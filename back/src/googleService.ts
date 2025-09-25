import axios from "axios";
import { config } from "./config";

type ExchangeParams = {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
};

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  [key: string]: unknown;
};

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const isRedirectAllowed = (redirectUri: string) => {
  if (config.google.redirectUris.length === 0) {
    return true;
  }
  return config.google.redirectUris.some((value) => value === redirectUri);
};

export const exchangeGoogleCode = async ({ code, redirectUri, codeVerifier }: ExchangeParams) => {

  if (!config.google.clientId || !config.google.clientSecret) {
    throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  if (!isRedirectAllowed(redirectUri)) {
    throw new Error(`redirect_uri "${redirectUri}" is not allowed. Configure GOOGLE_REDIRECT_URIS.`);
  }

  const payload = new URLSearchParams({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  if (codeVerifier) {
    payload.append("code_verifier", codeVerifier);
  }

  const response = await axios.post<GoogleTokenResponse>(
    GOOGLE_TOKEN_ENDPOINT,
    payload.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data;
};

const buildRefreshPayload = (refreshToken: string) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  const payload = new URLSearchParams({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  return payload;
};

export const refreshGoogleToken = async (refreshToken: string) => {
  const payload = buildRefreshPayload(refreshToken);

  const response = await axios.post<GoogleTokenResponse>(
    GOOGLE_TOKEN_ENDPOINT,
    payload.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return response.data;
};
