import { CalendarAccount } from "../../types/calendar";
import {
  Evento,
  removerEventosSincronizados,
  upsertEventoPorOutlookId,
} from "../../database";
import {
  updateCalendarAccountStatus,
  updateCalendarAccountTokens,
} from "../calendarAccountsStore";
import { persistProviderTokens } from "../calendarProviderActions";
import { buildApiUrl } from "../../config/api";
import { getOutlookOAuthConfig } from "../../config/outlookOAuth";

const TOKEN_ENDPOINT = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const CALENDAR_VIEW_ENDPOINT = "https://graph.microsoft.com/v1.0/me/calendarview";
const DEFAULT_DIFFICULTY = "Media";

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

const resolveDefaultTenant = () => {
  const config = getOutlookOAuthConfig();
  return config.defaultTenant || "common";
};

const resolveTenant = (account: CalendarAccount) => {
  if (account.tenantId) {
    return account.tenantId;
  }
  return resolveDefaultTenant();
};

const refreshAccessTokenLocally = async (account: CalendarAccount) => {
  const config = getOutlookOAuthConfig();
  const clientId = account.clientId ?? config.clientId;
  if (!clientId) {
    throw new Error("Client ID da Microsoft nao configurado para atualizar token.");
  }

  const scopes = config.scopes.join(" ");
  const payload = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: account.refreshToken as string,
    scope: scopes,
  });

  const response = await fetch(TOKEN_ENDPOINT(resolveTenant(account)), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error_description || data?.error || "Falha ao atualizar token do Outlook.";
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
    const message = (data as any)?.details?.message || (data as any)?.error || "Falha ao atualizar token do Outlook.";
    throw new Error(message);
  }

  return {
    accessToken: (data as any)?.accessToken as string,
    refreshToken: ((data as any)?.refreshToken as string | undefined) ?? account.refreshToken ?? null,
    expiresIn: typeof (data as any)?.expiresIn === "number" ? (data as any).expiresIn : null,
    expiresAt: typeof (data as any)?.expiresAt === "string" ? (data as any).expiresAt : null,
    scope: ((data as any)?.scope as string | undefined) ?? account.scope ?? null,
    tenantId: ((data as any)?.tenantId as string | undefined) ?? account.tenantId ?? null,
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
    throw new Error("Refresh token do Outlook nao disponivel.");
  }

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
    console.warn("[outlook] refresh local falhou, tentando via backend", error);
  }

  const backendTokens = await refreshAccessTokenViaBackend(account);
  if (!backendTokens.accessToken) {
    throw new Error("Falha ao atualizar token do Outlook.");
  }

  const expiresAtTimestamp = backendTokens.expiresAt
    ? new Date(backendTokens.expiresAt).getTime()
    : backendTokens.expiresIn
    ? Date.now() + backendTokens.expiresIn * 1000
    : null;

  await updateCalendarAccountTokens(account.id, {
    accessToken: backendTokens.accessToken,
    refreshToken: backendTokens.refreshToken ?? account.refreshToken ?? null,
    accessTokenExpiresAt: expiresAtTimestamp,
    scope: backendTokens.scope ?? account.scope ?? null,
  });

  if (expiresAtTimestamp) {
    await persistProviderTokens(account.id, {
      accessToken: backendTokens.accessToken,
      refreshToken: backendTokens.refreshToken ?? account.refreshToken ?? null,
      expiresAt: expiresAtTimestamp,
      scope: backendTokens.scope ?? account.scope ?? null,
    });
  }

  return backendTokens.accessToken;
};

type OutlookDateTime = {
  dateTime?: string;
  timeZone?: string;
};

type OutlookEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  start?: OutlookDateTime;
  end?: OutlookDateTime;
  lastModifiedDateTime?: string;
};

const parseOutlookDate = (value?: OutlookDateTime): string | null => {
  if (!value) {
    return null;
  }
  if (value.dateTime) {
    return normalizarIso(value.dateTime);
  }
  return null;
};

const mapOutlookToEvento = (
  item: OutlookEvent,
  account: CalendarAccount
): Evento | null => {
  const inicioIso = parseOutlookDate(item.start);
  if (!inicioIso) {
    return null;
  }
  const fimIso = parseOutlookDate(item.end) ?? inicioIso;
  const tempoExecucao = Math.max(1, diferencaEmMinutos(inicioIso, fimIso));

  return {
    titulo: item.subject ?? "Evento sem titulo",
    observacao: item.bodyPreview ?? item.body?.content ?? undefined,
    data: inicioIso,
    tipo: "Outlook Calendar",
    dificuldade: DEFAULT_DIFFICULTY,
    tempoExecucao,
    inicio: inicioIso,
    fim: fimIso,
    cor: account.color,
    outlookId: item.id,
    updatedAt: item.lastModifiedDateTime ?? new Date().toISOString(),
    provider: "outlook",
    accountId: account.id,
  };
};

const buildTimeRangeQuery = () => {
  const now = new Date();
  const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    start: past.toISOString(),
    end: future.toISOString(),
  };
};

export const syncOutlookAccount = async (account: CalendarAccount) => {
  await updateCalendarAccountStatus(account.id, {
    status: "syncing",
    errorMessage: null,
  });

  const accessToken = await ensureAccessToken(account);
  const { start, end } = buildTimeRangeQuery();

  let nextLink: string | null = `${CALENDAR_VIEW_ENDPOINT}?startdatetime=${encodeURIComponent(
    start
  )}&enddatetime=${encodeURIComponent(end)}&$top=50&$orderby=start/dateTime`;
  const eventos: Evento[] = [];

  while (nextLink) {
    const response = await fetch(nextLink, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || "Falha ao consultar eventos do Outlook.");
    }

    const items: OutlookEvent[] = Array.isArray(payload.value) ? payload.value : [];
    for (const item of items) {
      const evento = mapOutlookToEvento(item, account);
      if (evento) {
        eventos.push(evento);
      }
    }

    const rawNext = payload['@odata.nextLink'];
    nextLink = typeof rawNext === "string" ? rawNext : null;
  }

  await removerEventosSincronizados("outlook", { accountId: account.id });
  for (const evento of eventos) {
    await upsertEventoPorOutlookId(evento);
  }

  await updateCalendarAccountStatus(account.id, {
    status: "idle",
    lastSync: new Date().toISOString(),
    errorMessage: null,
  });
};
export const deleteOutlookEvent = async (
  account: CalendarAccount,
  outlookEventId: string
) => {
  if (!outlookEventId) {
    return;
  }

  try {
    const accessToken = await ensureAccessToken(account);
    await fetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(outlookEventId)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    console.warn('[outlook] erro ao remover evento remoto', error);
  }
};



