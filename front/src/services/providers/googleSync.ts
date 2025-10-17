import { CalendarAccount } from "../../types/calendar";
import {
  Evento,
  removerEventosSincronizados,
  upsertEventoPorGoogleId,
} from "../../database";
import {
  updateCalendarAccountStatus,
  updateCalendarAccountTokens,
} from "../calendarAccountsStore";
import { persistProviderTokens } from "../calendarProviderActions";
import { buildApiUrl } from "../../config/api";
import { GOOGLE_OAUTH_CONFIG } from "../../config/googleOAuth";
import { triggerEventSync } from "../eventSync";
import { inferirTipoPelaCor } from "../../utils/taskTypes";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";
const DEFAULT_CALENDAR_ID = "primary";
const DEFAULT_DIFFICULTY = "Media";
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const FIRST_SYNC_CUTOFF_DAYS = 3;

const diferencaEmMinutos = (inicio?: string | null, fim?: string | null) => {
  if (!inicio || !fim) {
    return 0;
  }
  const inicioDate = new Date(inicio);
  const fimDate = new Date(fim);
  if (Number.isNaN(inicioDate.getTime()) || Number.isNaN(fimDate.getTime())) {
    return 0;
  }
  const diff = Math.max(0, fimDate.getTime() - inicioDate.getTime());
  return Math.round(diff / 60000);
};

const normalizarIso = (value?: string | null) => {
  if (!value) {
    return new Date().toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
};

const extractGoogleDate = (value?: { date?: string; dateTime?: string }): string | null => {
  if (!value) {
    return null;
  }
  if (value.dateTime) {
    return normalizarIso(value.dateTime);
  }
  if (value.date) {
    return normalizarIso(`${value.date}T00:00:00.000Z`);
  }
  return null;
};

const resolveGoogleClientId = (account: CalendarAccount) => {
  if (account.clientId) {
    return account.clientId;
  }
  const { webClientId, expoClientId, androidClientId, iosClientId } = GOOGLE_OAUTH_CONFIG;
  return webClientId || expoClientId || androidClientId || iosClientId || null;
};

const refreshAccessTokenLocally = async (account: CalendarAccount) => {
  const clientId = resolveGoogleClientId(account);
  if (!clientId) {
    throw new Error("Client ID do Google nao configurado para atualizar token.");
  }

  const payload = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: account.refreshToken as string,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error_description || data?.error || "Falha ao atualizar token do Google.";
    throw new Error(message);
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | undefined) ?? account.refreshToken ?? null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
    scope: (data.scope as string | undefined) ?? account.scope ?? null,
    rawPayload: data as Record<string, unknown>,
  };
};

const refreshAccessTokenViaBackend = async (account: CalendarAccount) => {
  const response = await fetch(buildApiUrl(`/accounts/${account.id}/refresh`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as any)?.details?.message || (data as any)?.error || "Falha ao atualizar token do Google.";
    throw new Error(message);
  }

  return {
    accessToken: (data as any)?.accessToken as string,
    refreshToken: ((data as any)?.refreshToken as string | undefined) ?? account.refreshToken ?? null,
    expiresIn: typeof (data as any)?.expiresIn === "number" ? (data as any).expiresIn : null,
    expiresAt: typeof (data as any)?.expiresAt === "string" ? (data as any).expiresAt : null,
    scope: ((data as any)?.scope as string | undefined) ?? account.scope ?? null,
  };
};

const ensureAccessToken = async (account: CalendarAccount) => {
  if (
    account.accessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt > Date.now() + 60_000
  ) {
    return account.accessToken;
  }

  if (!account.refreshToken) {
    console.warn("[google] refresh token ausente, tentando via backend");
  } else {
    try {
      const localTokens = await refreshAccessTokenLocally(account);
      const expiresAt = Date.now() + localTokens.expiresIn * 1000;

      await updateCalendarAccountTokens(account.id, {
        accessToken: localTokens.accessToken,
        refreshToken: localTokens.refreshToken,
        accessTokenExpiresAt: expiresAt,
        scope: localTokens.scope,
      });

      await persistProviderTokens(account.id, {
        accessToken: localTokens.accessToken,
        refreshToken: localTokens.refreshToken,
        expiresAt,
        scope: localTokens.scope,
        rawPayload: localTokens.rawPayload,
      });

      return localTokens.accessToken;
    } catch (error) {
      console.warn("[google] refresh local falhou, tentando via backend", error);
    }
  }

  const backendTokens = await refreshAccessTokenViaBackend(account);
  if (!backendTokens.accessToken) {
    throw new Error("Falha ao atualizar token do Google.");
  }

  const expiresAtTimestamp = backendTokens.expiresAt
    ? new Date(backendTokens.expiresAt).getTime()
    : backendTokens.expiresIn
    ? Date.now() + backendTokens.expiresIn * 1000
    : null;

  const resolvedRefreshToken = backendTokens.refreshToken ?? account.refreshToken ?? null;
  if (!resolvedRefreshToken) {
    throw new Error("Refresh token do Google nao disponivel.");
  }

  await updateCalendarAccountTokens(account.id, {
    accessToken: backendTokens.accessToken,
    refreshToken: resolvedRefreshToken,
    accessTokenExpiresAt: expiresAtTimestamp,
    scope: backendTokens.scope ?? account.scope ?? null,
  });

  if (expiresAtTimestamp) {
    await persistProviderTokens(account.id, {
      accessToken: backendTokens.accessToken,
      refreshToken: resolvedRefreshToken,
      expiresAt: expiresAtTimestamp,
      scope: backendTokens.scope ?? account.scope ?? null,
    });
  }

  return backendTokens.accessToken;
};

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  updated?: string;
  colorId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

const mapGoogleToEvento = (
  item: GoogleEvent,
  account: CalendarAccount
): Evento | null => {
  const inicioIso = extractGoogleDate(item.start);
  if (!inicioIso) {
    return null;
  }
  const fimIso = extractGoogleDate(item.end) ?? inicioIso;
  const tempoExecucao = Math.max(1, diferencaEmMinutos(inicioIso, fimIso));

  return {
    titulo: item.summary ?? "Evento sem titulo",
    observacao: item.description ?? undefined,
    data: inicioIso,
    tipo: inferirTipoPelaCor(account.color),
    dificuldade: DEFAULT_DIFFICULTY,
    tempoExecucao,
    inicio: inicioIso,
    fim: fimIso,
    cor: account.color,
    googleId: item.id,
    updatedAt: item.updated ?? new Date().toISOString(),
    provider: "google",
    accountId: account.id,
  };
};

const buildTimeRangeQuery = (account: CalendarAccount) => {
  const now = Date.now();
  const past = new Date(now - 7 * DAY_IN_MS);
  const defaultFuture = new Date(now + 30 * DAY_IN_MS);
  const isFirstSync = !account.lastSync;
  const firstSyncLimit = new Date(now - FIRST_SYNC_CUTOFF_DAYS * DAY_IN_MS);
  const effectiveMax = isFirstSync ? firstSyncLimit : defaultFuture;
  const sanitizedMax = effectiveMax.getTime() < past.getTime() ? past : effectiveMax;

  return {
    timeMin: past.toISOString(),
    timeMax: sanitizedMax.toISOString(),
    maxTimestamp: sanitizedMax.getTime(),
    enforceMax: isFirstSync,
  };
};

export const syncGoogleAccount = async (account: CalendarAccount) => {
  await updateCalendarAccountStatus(account.id, {
    status: "syncing",
    errorMessage: null,
  });

  const accessToken = await ensureAccessToken(account);
  const calendarId = encodeURIComponent(account.calendarId ?? DEFAULT_CALENDAR_ID);
  const { timeMin, timeMax, maxTimestamp, enforceMax } = buildTimeRangeQuery(account);

  let pageToken: string | undefined;
  const eventos: Evento[] = [];

  do {
    const url = new URL(`${EVENTS_ENDPOINT}/${calendarId}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || "Falha ao consultar eventos do Google Calendar.");
    }

    const items: GoogleEvent[] = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const evento = mapGoogleToEvento(item, account);
      if (evento) {
        if (enforceMax) {
          const inicio = new Date(evento.inicio ?? evento.data ?? "");
          if (!Number.isNaN(inicio.getTime()) && inicio.getTime() > maxTimestamp) {
            continue;
          }
        }
        eventos.push(evento);
      }
    }

    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined;
  } while (pageToken);

  await removerEventosSincronizados("google", { accountId: account.id });
  for (const evento of eventos) {
    await upsertEventoPorGoogleId(evento);
  }

  try {
    await triggerEventSync({ force: true });
  } catch (error) {
    console.warn("[google] failed to trigger sync after provider import", error);
  }

  await updateCalendarAccountStatus(account.id, {
    status: "idle",
    lastSync: new Date().toISOString(),
    errorMessage: null,
  });
};
export const deleteGoogleEvent = async (
  account: CalendarAccount,
  googleEventId: string
) => {
  if (!googleEventId) {
    return;
  }

  try {
    const accessToken = await ensureAccessToken(account);
    const calendarId = encodeURIComponent(account.calendarId ?? DEFAULT_CALENDAR_ID);
    await fetch(
      `${EVENTS_ENDPOINT}/${calendarId}/events/${encodeURIComponent(googleEventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  } catch (error) {
    console.warn('[google] erro ao remover evento remoto', error);
  }
};


