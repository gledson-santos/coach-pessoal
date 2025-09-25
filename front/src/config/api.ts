const DEFAULT_API_BASE_URL = "http://localhost:4001";

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");

export const buildApiUrl = (path: string): string => {
  if (!path) {
    return API_BASE_URL;
  }
  return path.startsWith("/") ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
};
