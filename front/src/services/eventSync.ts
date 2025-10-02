import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  atualizarEvento,
  encontrarEventoPorSyncId,
  listarEventosAtualizadosDesde,
  salvarEvento,
  subscribeEventoChanges,
  Evento,
} from "../database";
import { buildApiUrl } from "../config/api";

const STORAGE_KEY = "@coach/eventSync";
const MAX_EVENTS_PER_BATCH = 50;
const MAX_SYNC_CACHE_ENTRIES = 1000;
const SYNC_INTERVAL = 5 * 60 * 1000;
const IMMEDIATE_SYNC_DELAY = 2_000;
const INITIAL_SYNC_DELAY = 1_000;
const MIN_REMOTE_SYNC_INTERVAL = 30 * 1000;

let initialized = false;
let stateLoaded = false;
let syncing = false;
let pending = false;
let pendingForce = false;
let hasPendingLocalChanges = false;
let suppressNotifications = false;

let lastSyncAt: string | null = null;
let lastRemoteSyncAt: number | null = null;
const syncedEventVersions = new Map<string, string>();
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let immediateTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeChanges: (() => void) | null = null;

const enforceSyncedCacheLimit = () => {
  while (syncedEventVersions.size > MAX_SYNC_CACHE_ENTRIES) {
    const iterator = syncedEventVersions.keys().next();
    if (iterator.done || !iterator.value) {
      break;
    }
    syncedEventVersions.delete(iterator.value);
  }
};

const sanitizeIso = (value?: string | null): string | null => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

const sanitizeOptionalString = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type SyncEventPayload = {
  id: string;
  title: string;
  notes: string | null;
  date: string | null;
  type: string;
  difficulty: string;
  duration: number;
  start: string | null;
  end: string | null;
  color: string | null;
  status: string | null;
  provider: string | null;
  accountId: string | null;
  googleId: string | null;
  outlookId: string | null;
  icsUid: string | null;
  updatedAt: string;
  createdAt: string | null;
  integrationDate: string | null;
  integrationDateProvided?: boolean;
};

type SyncResponse = {
  events?: SyncEventPayload[];
  serverTime?: string;
};

const loadState = async () => {
  if (stateLoaded) {
    return;
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        lastSyncAt?: string | null;
        syncedEvents?: Record<string, string> | null;
        lastRemoteSyncAt?: number | string | null;
      };
      if (typeof parsed?.lastSyncAt === "string" && parsed.lastSyncAt.trim()) {
        const iso = sanitizeIso(parsed.lastSyncAt);
        lastSyncAt = iso ?? lastSyncAt;
      }
      if (
        parsed?.lastRemoteSyncAt !== undefined &&
        parsed.lastRemoteSyncAt !== null
      ) {
        const candidate = parsed.lastRemoteSyncAt;
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          lastRemoteSyncAt = candidate;
        } else if (typeof candidate === "string" && candidate.trim()) {
          const timestamp = Number(candidate);
          if (Number.isFinite(timestamp)) {
            lastRemoteSyncAt = timestamp;
          }
        }
      }
      if (parsed?.syncedEvents && typeof parsed.syncedEvents === "object") {
        Object.entries(parsed.syncedEvents).forEach(([id, updatedAt]) => {
          if (typeof id === "string" && typeof updatedAt === "string") {
            const iso = sanitizeIso(updatedAt);
            if (iso) {
              syncedEventVersions.set(id, iso);
              enforceSyncedCacheLimit();
            }
          }
        });
      }
    }
  } catch (error) {
    console.warn("[eventSync] failed to load state", error);
  }
  stateLoaded = true;
};

const persistState = async () => {
  try {
    const syncedEvents = Object.fromEntries(syncedEventVersions.entries());
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lastSyncAt, syncedEvents, lastRemoteSyncAt })
    );
  } catch (error) {
    console.warn("[eventSync] failed to persist state", error);
  }
};

const refreshPendingLocalChanges = async () => {
  await loadState();
  try {
    const locais = await listarEventosAtualizadosDesde(lastSyncAt);
    hasPendingLocalChanges = locais.length > 0;
  } catch (error) {
    console.warn("[eventSync] failed to check pending local changes", error);
    throw error;
  }
};

const scheduleImmediateSync = (
  delay = IMMEDIATE_SYNC_DELAY,
  options: { force?: boolean } = {}
) => {
  if (!initialized) {
    return;
  }
  if (immediateTimer) {
    clearTimeout(immediateTimer);
  }
  immediateTimer = setTimeout(() => {
    immediateTimer = null;
    triggerEventSync(options).catch((error) => {
      console.warn("[eventSync] immediate sync failed", error);
    });
  }, delay);
};

const startInterval = () => {
  if (intervalTimer) {
    clearInterval(intervalTimer);
  }
  intervalTimer = setInterval(() => {
    triggerEventSync().catch((error) => {
      console.warn("[eventSync] scheduled sync failed", error);
    });
  }, SYNC_INTERVAL);
};

const mapLocalToPayload = (evento: Evento): SyncEventPayload | null => {
  if (!evento.syncId || !evento.syncId.trim()) {
    return null;
  }
  const updatedAt = sanitizeIso(evento.updatedAt) ?? new Date().toISOString();
  const createdAt = sanitizeIso(evento.createdAt) ?? updatedAt;
  const duration =
    typeof evento.tempoExecucao === "number" && Number.isFinite(evento.tempoExecucao)
      ? Math.max(1, Math.round(evento.tempoExecucao))
      : 15;
  const provider = sanitizeOptionalString(evento.provider as string) ?? "local";
  const accountId = sanitizeOptionalString(evento.accountId ?? undefined);
  const hasIntegrationDate = evento.integrationDate !== undefined;
  const integrationDate = hasIntegrationDate ? sanitizeIso(evento.integrationDate) ?? null : null;

  return {
    id: evento.syncId,
    title: evento.titulo,
    notes: sanitizeOptionalString(evento.observacao),
    date: sanitizeIso(evento.data) ?? sanitizeOptionalString(evento.data),
    type: evento.tipo,
    difficulty: evento.dificuldade,
    duration,
    start: sanitizeIso(evento.inicio) ?? sanitizeOptionalString(evento.inicio),
    end: sanitizeIso(evento.fim) ?? sanitizeOptionalString(evento.fim),
    color: sanitizeOptionalString(evento.cor),
    status: sanitizeOptionalString(evento.status) ?? "ativo",
    provider,
    accountId,
    googleId: sanitizeOptionalString(evento.googleId),
    outlookId: sanitizeOptionalString(evento.outlookId),
    icsUid: sanitizeOptionalString(evento.icsUid),
    updatedAt,
    createdAt,
    integrationDate,
    integrationDateProvided: hasIntegrationDate,
  };
};

const mapRemoteToEvento = (payload: SyncEventPayload): Evento => {
  const updatedAt = sanitizeIso(payload.updatedAt) ?? new Date().toISOString();
  const createdAt =
    sanitizeIso(payload.createdAt) ??
    sanitizeIso(payload.updatedAt) ??
    updatedAt;
  const duration =
    typeof payload.duration === "number" && Number.isFinite(payload.duration)
      ? Math.max(1, Math.round(payload.duration))
      : 15;
  const title = sanitizeOptionalString(payload.title) ?? "Evento";
  const type = sanitizeOptionalString(payload.type) ?? "Tarefa";
  const difficulty = sanitizeOptionalString(payload.difficulty) ?? "Media";
  const provider = sanitizeOptionalString(payload.provider) ?? "local";
  const status = sanitizeOptionalString(payload.status);
  const accountId = sanitizeOptionalString(payload.accountId);
  const integrationDate = sanitizeIso(payload.integrationDate) ?? null;
  return {
    titulo: title,
    observacao: payload.notes ?? undefined,
    data: payload.date ?? undefined,
    tipo: type,
    dificuldade: difficulty,
    tempoExecucao: duration,
    inicio: payload.start ?? undefined,
    fim: payload.end ?? undefined,
    cor: payload.color ?? undefined,
    status: status ?? undefined,
    provider: (provider as Evento["provider"]) ?? "local",
    accountId: accountId ?? null,
    googleId: payload.googleId ?? undefined,
    outlookId: payload.outlookId ?? undefined,
    icsUid: payload.icsUid ?? undefined,
    updatedAt,
    createdAt,
    syncId: payload.id,
    integrationDate: integrationDate ?? undefined,
  };
};

const applyRemoteEvents = async (events: SyncEventPayload[]) => {
  if (events.length === 0) {
    return;
  }
  suppressNotifications = true;
  try {
    for (const event of events) {
      if (!event.id || !event.updatedAt) {
        continue;
      }
      const local = await encontrarEventoPorSyncId(event.id);
      const incoming = mapRemoteToEvento(event);
      if (local?.updatedAt && sanitizeIso(local.updatedAt) === incoming.updatedAt) {
        continue;
      }
      if (local?.id) {
        await atualizarEvento({ ...local, ...incoming, id: local.id });
      } else {
        await salvarEvento(incoming);
      }
    }
  } finally {
    suppressNotifications = false;
  }
};

const filterSyncedPayload = (events: SyncEventPayload[]) => {
  return events.filter((item) => {
    const normalized = sanitizeIso(item.updatedAt) ?? item.updatedAt;
    const existing = syncedEventVersions.get(item.id);
    if (!existing) {
      return true;
    }
    return existing !== normalized;
  });
};

const chunkEvents = (events: SyncEventPayload[]) => {
  if (events.length <= MAX_EVENTS_PER_BATCH) {
    return [events];
  }
  const chunks: SyncEventPayload[][] = [];
  for (let i = 0; i < events.length; i += MAX_EVENTS_PER_BATCH) {
    chunks.push(events.slice(i, i + MAX_EVENTS_PER_BATCH));
  }
  return chunks;
};

const performSync = async (forceRemotePull: boolean) => {
  await loadState();
  const since = lastSyncAt;
  const locais = await listarEventosAtualizadosDesde(since);
  const payload = filterSyncedPayload(
    locais
    .map(mapLocalToPayload)
    .filter((item): item is SyncEventPayload => item !== null)
  );

  const now = Date.now();
  const shouldFetchRemote =
    forceRemotePull ||
    payload.length > 0 ||
    !since ||
    lastRemoteSyncAt === null ||
    now - lastRemoteSyncAt >= MIN_REMOTE_SYNC_INTERVAL;

  if (!shouldFetchRemote) {
    if (!pending) {
      hasPendingLocalChanges = false;
    }
    return;
  }

  const chunks = payload.length > 0 ? chunkEvents(payload) : [[]];
  const remoteEventMap = new Map<string, SyncEventPayload>();
  let latestServerTime: string | null = null;
  let performedNetworkRequest = false;

  for (const chunk of chunks) {
    const body = JSON.stringify({
      since,
      events: chunk,
    });

    const response = await fetch(buildApiUrl("/sync/events"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    const data: SyncResponse = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = (data as any)?.error || response.statusText || "Sync failed";
      throw new Error(message);
    }

    performedNetworkRequest = true;

    const remoteEvents = Array.isArray(data.events) ? data.events : [];
    for (const event of remoteEvents) {
      if (!event?.id) {
        continue;
      }
      const existing = remoteEventMap.get(event.id);
      if (!existing) {
        remoteEventMap.set(event.id, event);
        continue;
      }
      const existingTime = sanitizeIso(existing.updatedAt);
      const incomingTime = sanitizeIso(event.updatedAt);
      if (!existingTime || !incomingTime) {
        remoteEventMap.set(event.id, event);
        continue;
      }
      if (new Date(incomingTime).getTime() > new Date(existingTime).getTime()) {
        remoteEventMap.set(event.id, event);
      }
    }

    const serverTimeIso = sanitizeIso(data.serverTime);
    if (serverTimeIso) {
      latestServerTime = serverTimeIso;
    }

    if (chunk.length > 0) {
      chunk.forEach((item) => {
        if (item?.id && item?.updatedAt) {
          const normalized = sanitizeIso(item.updatedAt) ?? item.updatedAt;
          if (normalized) {
            syncedEventVersions.set(item.id, normalized);
            enforceSyncedCacheLimit();
          }
        }
      });
    }
  }

  const remoteEvents = Array.from(remoteEventMap.values());
  await applyRemoteEvents(remoteEvents);

  const serverTimeIso = latestServerTime ?? new Date().toISOString();
  lastSyncAt = serverTimeIso;
  if (performedNetworkRequest) {
    lastRemoteSyncAt = Date.now();
  }
  await persistState();
  if (!pending) {
    hasPendingLocalChanges = false;
  }
};

export const triggerEventSync = async (options: { force?: boolean } = {}) => {
  const { force = false } = options;
  if (force && immediateTimer) {
    clearTimeout(immediateTimer);
    immediateTimer = null;
  }
  if (syncing) {
    pending = true;
    pendingForce = pendingForce || force;
    return;
  }
  syncing = true;
  pending = false;
  pendingForce = force;
  try {
    await performSync(force);
  } catch (error) {
    console.warn("[eventSync] sync failed", error);
    throw error;
  } finally {
    syncing = false;
    if (pending) {
      const forceNext = pendingForce;
      pending = false;
      pendingForce = false;
      scheduleImmediateSync(IMMEDIATE_SYNC_DELAY, { force: forceNext });
    } else {
      pendingForce = false;
    }
  }
};

export const initializeEventSync = () => {
  if (initialized) {
    return;
  }
  initialized = true;
  startInterval();
  refreshPendingLocalChanges()
    .then(() => {
      const now = Date.now();
      const recentlySynced =
        lastRemoteSyncAt !== null && now - lastRemoteSyncAt < MIN_REMOTE_SYNC_INTERVAL;
      const shouldSchedule = hasPendingLocalChanges || !lastSyncAt || !recentlySynced;
      if (shouldSchedule) {
        const force = !lastSyncAt;
        scheduleImmediateSync(INITIAL_SYNC_DELAY, { force });
      }
    })
    .catch((error) => {
      console.warn("[eventSync] failed to refresh pending changes", error);
      scheduleImmediateSync(INITIAL_SYNC_DELAY, { force: true });
    });
  unsubscribeChanges = subscribeEventoChanges(() => {
    if (suppressNotifications) {
      return;
    }
    hasPendingLocalChanges = true;
    scheduleImmediateSync();
  });
};

export const disposeEventSync = () => {
  if (!initialized) {
    return;
  }
  initialized = false;
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (immediateTimer) {
    clearTimeout(immediateTimer);
    immediateTimer = null;
  }
  if (unsubscribeChanges) {
    unsubscribeChanges();
    unsubscribeChanges = null;
  }
};

