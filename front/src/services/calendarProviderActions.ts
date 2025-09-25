import { CalendarProvider } from "../types/calendar";
import { buildApiUrl } from "../config/api";
import { findCalendarAccount } from "./calendarAccountsStore";
import { deleteGoogleEvent } from "./providers/googleSync";
import { deleteOutlookEvent } from "./providers/outlookSync";


export const persistProviderTokens = async (
  accountId: string,
  tokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | string | Date | null;
    scope?: string | null;
    rawPayload?: Record<string, unknown> | null;
  }
) => {
  if (!accountId) {
    return;
  }
  const body: Record<string, unknown> = {};
  if (tokens.accessToken !== undefined) {
    body.accessToken = tokens.accessToken;
  }
  if (tokens.refreshToken !== undefined) {
    body.refreshToken = tokens.refreshToken;
  }
  if (tokens.scope !== undefined) {
    body.scope = tokens.scope;
  }
  if (tokens.rawPayload !== undefined) {
    body.rawPayload = tokens.rawPayload;
  }
  if (tokens.expiresAt !== undefined) {
    const value = tokens.expiresAt;
    let iso: string | null = null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      iso = value.toISOString();
    } else if (typeof value === "number" && Number.isFinite(value)) {
      iso = new Date(value).toISOString();
    } else if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        iso = parsed.toISOString();
      }
    }
    if (iso) {
      body.expiresAt = iso;
    }
  }
  if (Object.keys(body).length === 0) {
    return;
  }
  try {
    await fetch(buildApiUrl(`/accounts/${accountId}/tokens`), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.warn("[tokens] falha ao atualizar tokens no backend", error);
  }
};

export const deleteProviderEvent = async ({
  provider,
  accountId,
  externalId,
}: {
  provider?: CalendarProvider | null;
  accountId?: string | null;
  externalId?: string | null;
}) => {
  if (!provider || !accountId || !externalId) {
    return;
  }

  const account = findCalendarAccount(accountId);
  if (!account) {
    return;
  }

  if (provider === "google") {
    await deleteGoogleEvent(account, externalId);
    return;
  }

  if (provider === "outlook") {
    await deleteOutlookEvent(account, externalId);
  }
};

