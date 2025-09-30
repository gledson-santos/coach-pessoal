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
const SYNC_INTERVAL = 5 * 60 * 1000;
const IMMEDIATE_SYNC_DELAY = 2_000;
const INITIAL_SYNC_DELAY = 1_000;

let initialized = false;
let stateLoaded = false;
let syncing = false;
let pending = false;
let suppressNotifications = false;

let lastSyncAt: string | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let immediateTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeChanges: (() => void) | null = null;

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
      const parsed = JSON.parse(raw) as { lastSyncAt?: string | null };
      if (typeof parsed?.lastSyncAt === "string" && parsed.lastSyncAt.trim()) {
        const iso = sanitizeIso(parsed.lastSyncAt);
        lastSyncAt = iso ?? lastSyncAt;
      }
    }
  } catch (error) {
    console.warn("[eventSync] failed to load state", error);
  }
  stateLoaded = true;
};

const persistState = async () => {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lastSyncAt })
    );
  } catch (error) {
    console.warn("[eventSync] failed to persist state", error);
  }
};

const scheduleImmediateSync = (delay = IMMEDIATE_SYNC_DELAY) => {
  if (!initialized) {
    return;
  }
  if (immediateTimer) {
    clearTimeout(immediateTimer);
  }
  immediateTimer = setTimeout(() => {
    triggerEventSync().catch((error) => {
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

const performSync = async () => {
  await loadState();
  const since = lastSyncAt;
  const locais = await listarEventosAtualizadosDesde(since);
  const payload = locais
    .map(mapLocalToPayload)
    .filter((item): item is SyncEventPayload => item !== null);

  const body = JSON.stringify({
    since,
    events: payload,
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

  const remoteEvents = Array.isArray(data.events) ? data.events : [];
  await applyRemoteEvents(remoteEvents);

  const serverTimeIso = sanitizeIso(data.serverTime) ?? new Date().toISOString();
  lastSyncAt = serverTimeIso;
  await persistState();
};

export const triggerEventSync = async () => {
  if (syncing) {
    pending = true;
    return;
  }
  syncing = true;
  pending = false;
  try {
    await performSync();
  } catch (error) {
    console.warn("[eventSync] sync failed", error);
    throw error;
  } finally {
    syncing = false;
    if (pending) {
      pending = false;
      scheduleImmediateSync(IMMEDIATE_SYNC_DELAY);
    }
  }
};

export const initializeEventSync = () => {
  if (initialized) {
    return;
  }
  initialized = true;
  startInterval();
  scheduleImmediateSync(INITIAL_SYNC_DELAY);
  unsubscribeChanges = subscribeEventoChanges(() => {
    if (suppressNotifications) {
      return;
    }
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

