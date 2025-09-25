const base64UrlDecode = (input: string): string => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padding);
  return Buffer.from(padded, "base64").toString("utf8");
};

export const decodeIdTokenPayload = <T = Record<string, unknown>>(idToken?: string | null): T | null => {
  if (!idToken || typeof idToken !== "string") {
    return null;
  }
  const segments = idToken.split(".");
  if (segments.length < 2) {
    return null;
  }
  try {
    const payloadJson = base64UrlDecode(segments[1]);
    return JSON.parse(payloadJson) as T;
  } catch {
    return null;
  }
};
