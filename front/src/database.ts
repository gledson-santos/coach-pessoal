import * as SQLite from "expo-sqlite";
import {
  DEFAULT_CALENDAR_CATEGORY,
  getCalendarColorByType,
} from "./constants/calendarCategories";
import { CalendarProvider } from "./types/calendar";
import { normalizeToIsoString } from "./utils/date";
import { normalizarTipoTarefa } from "./utils/taskTypes";

export type Evento = {
  id?: number;
  titulo: string;
  observacao?: string;
  data?: string;
  tipo: string;
  dificuldade: string;
  tempoExecucao?: number;
  inicio?: string;
  fim?: string;
  cor?: string;
  googleId?: string;
  outlookId?: string;
  icsUid?: string;
  updatedAt?: string;
  createdAt?: string;
  syncId?: string;
  provider?: CalendarProvider | "local";
  accountId?: string | null;
  status?: "ativo" | "removido" | string;
  integrationDate?: string | null;
  sentimentoInicio?: number | null;
  sentimentoFim?: number | null;
  concluida?: boolean;
  pomodoroStage?: "focus" | "break" | "finished" | null;
  pomodoroCurrentCycle?: number | null;
  pomodoroTargetTimestamp?: string | null;
  pomodoroRemainingMs?: number | null;
  pomodoroPaused?: boolean | null;
  pomodoroAwaitingAction?: boolean | null;
  pomodoroCycleDurations?: number[] | null;
  pomodoroBreakDuration?: number | null;
};

const DEFAULT_TEMPO_EXECUCAO = 15;

const sanitizeTempoExecucao = (
  value: unknown,
  fallback: number = DEFAULT_TEMPO_EXECUCAO
): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.round(parsed));
    }
  }

  return Math.max(1, Math.round(fallback));
};

const sanitizeSentimento = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const bounded = Math.round(value);
    if (bounded >= 1 && bounded <= 5) {
      return bounded;
    }
    return Math.min(5, Math.max(1, bounded));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return sanitizeSentimento(parsed);
    }
  }

  return null;
};

const sanitizeBoolean = (value: unknown, fallback: boolean = false) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return fallback;
};

const sanitizeNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0) {
      return 0;
    }
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return sanitizeNonNegativeInteger(parsed);
    }
  }
  return null;
};

const sanitizePomodoroStage = (
  value: unknown
): "focus" | "break" | "finished" | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "focus" || normalized === "break" || normalized === "finished") {
    return normalized as "focus" | "break" | "finished";
  }
  return null;
};

const sanitizeCycleDurations = (value: unknown): number[] | null => {
  if (!value && value !== 0) {
    return null;
  }
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const sanitized: number[] = [];
  parsed.forEach((item) => {
    const sanitizedItem = sanitizeNonNegativeInteger(item);
    if (sanitizedItem !== null && sanitizedItem > 0) {
      sanitized.push(sanitizedItem);
    }
  });
  if (!sanitized.length) {
    return null;
  }
  return sanitized;
};

const adicionarColuna = async (
  database: SQLite.SQLiteDatabase,
  column: string,
  ddl: string
) => {
  try {
    await database.execAsync(`ALTER TABLE eventos ADD COLUMN ${column} ${ddl}`);
  } catch {
    // coluna pode existir
  }
};

const generateSyncId = (): string => {
  try {
    const globalObj: any = typeof globalThis !== "undefined" ? globalThis : {};
    const cryptoObj = globalObj?.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
  } catch {
    // fallback abaixo
  }
  const timestamp = Date.now().toString(16);
  const random = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `evt-${timestamp}-${random}`;
};

const changeListeners = new Set<() => void>();

const notifyChange = () => {
  changeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn("[database] listener execution failed", error);
    }
  });
};

const assignMissingSyncMetadata = async (database: SQLite.SQLiteDatabase) => {
  const rows = await database.getAllAsync<{ id: number }>(
    "SELECT id FROM eventos WHERE syncId IS NULL OR TRIM(syncId) = ''"
  );
  for (const row of rows) {
    await database.runAsync("UPDATE eventos SET syncId = ? WHERE id = ?", [
      generateSyncId(),
      row.id,
    ]);
  }

  await database.execAsync(
    "UPDATE eventos SET updatedAt = COALESCE(updatedAt, datetime('now')) WHERE updatedAt IS NULL OR TRIM(updatedAt) = ''"
  );
  await database.execAsync(
    "UPDATE eventos SET createdAt = COALESCE(createdAt, updatedAt, datetime('now')) WHERE createdAt IS NULL OR TRIM(createdAt) = ''"
  );
};

const dbPromise = (async () => {
  const database = await SQLite.openDatabaseAsync("coach.db");
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      observacao TEXT,
      data TEXT,
      tipo TEXT NOT NULL,
      dificuldade TEXT NOT NULL,
      tempoExecucao INTEGER DEFAULT 15,
      inicio TEXT,
      fim TEXT,
      cor TEXT,
      googleId TEXT,
      outlookId TEXT,
      icsUid TEXT,
      updatedAt TEXT,
      createdAt TEXT,
      syncId TEXT,
      provider TEXT DEFAULT 'local',
      accountId TEXT,
      status TEXT DEFAULT 'ativo',
      sentimentoInicio INTEGER,
      sentimentoFim INTEGER,
      concluida INTEGER DEFAULT 0,
      pomodoroStage TEXT,
      pomodoroCurrentCycle INTEGER,
      pomodoroTargetTimestamp TEXT,
      pomodoroRemainingMs INTEGER,
      pomodoroPaused INTEGER DEFAULT 0,
      pomodoroAwaitingAction INTEGER DEFAULT 0,
      pomodoroCycleDurations TEXT,
      pomodoroBreakDuration INTEGER
    );
  `);

  await adicionarColuna(database, "tempoExecucao", "INTEGER DEFAULT 15");
  await adicionarColuna(database, "googleId", "TEXT");
  await adicionarColuna(database, "outlookId", "TEXT");
  await adicionarColuna(database, "icsUid", "TEXT");
  await adicionarColuna(database, "updatedAt", "TEXT");
  await adicionarColuna(database, "createdAt", "TEXT");
  await adicionarColuna(database, "syncId", "TEXT");
  await adicionarColuna(database, "provider", "TEXT DEFAULT 'local'");
  await adicionarColuna(database, "accountId", "TEXT");
  await adicionarColuna(database, "status", "TEXT DEFAULT 'ativo'");
  await adicionarColuna(database, "integrationDate", "TEXT");
  await adicionarColuna(database, "sentimentoInicio", "INTEGER");
  await adicionarColuna(database, "sentimentoFim", "INTEGER");
  await adicionarColuna(database, "concluida", "INTEGER DEFAULT 0");
  await adicionarColuna(database, "pomodoroStage", "TEXT");
  await adicionarColuna(database, "pomodoroCurrentCycle", "INTEGER");
  await adicionarColuna(database, "pomodoroTargetTimestamp", "TEXT");
  await adicionarColuna(database, "pomodoroRemainingMs", "INTEGER");
  await adicionarColuna(database, "pomodoroPaused", "INTEGER DEFAULT 0");
  await adicionarColuna(database, "pomodoroAwaitingAction", "INTEGER DEFAULT 0");
  await adicionarColuna(database, "pomodoroCycleDurations", "TEXT");
  await adicionarColuna(database, "pomodoroBreakDuration", "INTEGER");

  await database.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_eventos_provider ON eventos(provider)"
  );
  await database.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_eventos_account ON eventos(accountId)"
  );
  await database.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_eventos_google ON eventos(googleId)"
  );
  await database.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_eventos_outlook ON eventos(outlookId)"
  );
  await database.execAsync(
    "CREATE INDEX IF NOT EXISTS idx_eventos_ics ON eventos(icsUid)"
  );
  await database.execAsync(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_eventos_sync ON eventos(syncId)"
  );

  await assignMissingSyncMetadata(database);

  return database;
})();

let dbOperationQueue: Promise<void> = Promise.resolve();

const withDatabase = async <T>(
  operation: (database: SQLite.SQLiteDatabase) => Promise<T>
): Promise<T> => {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  const previous = dbOperationQueue;
  dbOperationQueue = previous.then(() => next);

  await previous;

  try {
    const database = await dbPromise;
    return await operation(database);
  } finally {
    release();
  }
};

const calcularFim = (inicioIso: string, tempoEmMinutos: number) => {
  if (!inicioIso || !tempoEmMinutos) {
    return inicioIso;
  }
  const inicio = new Date(inicioIso);
  if (Number.isNaN(inicio.getTime())) {
    return inicioIso;
  }
  const fim = new Date(inicio.getTime() + tempoEmMinutos * 60000);
  return fim.toISOString();
};

const sanitizeTipo = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = normalizarTipoTarefa(trimmed);
  if (normalized) {
    return normalized;
  }

  return trimmed;
};

const mapRowToEvento = (row: any): Evento => ({
  id: row.id,
  titulo: row.titulo,
  observacao: row.observacao ?? undefined,
  data: row.data ?? undefined,
  tipo: sanitizeTipo(row.tipo),
  dificuldade: row.dificuldade,
  tempoExecucao: sanitizeTempoExecucao(row.tempoExecucao),
  inicio: row.inicio ?? undefined,
  fim: row.fim ?? undefined,
  cor: row.cor ?? undefined,
  googleId: row.googleId ?? undefined,
  outlookId: row.outlookId ?? undefined,
  icsUid: row.icsUid ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
  createdAt: row.createdAt ?? undefined,
  syncId: row.syncId ?? undefined,
  provider: (row.provider as CalendarProvider | "local") ?? "local",
  accountId: row.accountId ?? null,
  status: row.status ?? undefined,
  integrationDate: row.integrationDate ?? undefined,
  sentimentoInicio: sanitizeSentimento(row.sentimentoInicio),
  sentimentoFim: sanitizeSentimento(row.sentimentoFim),
  concluida: sanitizeBoolean(row.concluida, false),
  pomodoroStage: sanitizePomodoroStage(row.pomodoroStage),
  pomodoroCurrentCycle: sanitizeNonNegativeInteger(row.pomodoroCurrentCycle),
  pomodoroTargetTimestamp: normalizeToIsoString(row.pomodoroTargetTimestamp),
  pomodoroRemainingMs: sanitizeNonNegativeInteger(row.pomodoroRemainingMs),
  pomodoroPaused: sanitizeBoolean(row.pomodoroPaused, false),
  pomodoroAwaitingAction: sanitizeBoolean(row.pomodoroAwaitingAction, false),
  pomodoroCycleDurations: sanitizeCycleDurations(row.pomodoroCycleDurations),
  pomodoroBreakDuration: sanitizeNonNegativeInteger(row.pomodoroBreakDuration),
});

const normalizarEvento = (ev: Evento): Evento => {
  const provider =
    ev.provider ??
    (ev.googleId ? "google" : ev.outlookId ? "outlook" : ev.icsUid ? "ics" : "local");
  const accountId = ev.accountId ?? null;
  const status = ev.status ?? "ativo";
  const tipo = sanitizeTipo(ev.tipo) || "Tarefa";
  const cor = getCalendarColorByType(tipo, ev.cor);
  const tempoExecucao = sanitizeTempoExecucao(ev.tempoExecucao);
  const sentimentoInicio =
    ev.sentimentoInicio === undefined
      ? undefined
      : sanitizeSentimento(ev.sentimentoInicio);
  const sentimentoFim =
    ev.sentimentoFim === undefined ? undefined : sanitizeSentimento(ev.sentimentoFim);
  const concluida =
    ev.concluida === undefined ? undefined : sanitizeBoolean(ev.concluida);
  let integrationDate: string | null | undefined;
  if (ev.integrationDate === undefined) {
    integrationDate = undefined;
  } else if (ev.integrationDate === null) {
    integrationDate = null;
  } else {
    integrationDate = normalizeToIsoString(ev.integrationDate) ?? null;
  }
  return {
    ...ev,
    tipo,
    provider,
    accountId,
    status,
    cor,
    tempoExecucao,
    integrationDate,
    sentimentoInicio,
    sentimentoFim,
    concluida,
  };
};

type InternalSaveOptions = {
  skipNotify?: boolean;
};

const salvarEventoInternal = async (
  db: SQLite.SQLiteDatabase,
  ev: Evento,
  options: InternalSaveOptions = {}
) => {
  const evento = normalizarEvento(ev);
  const tempo = sanitizeTempoExecucao(evento.tempoExecucao);
  const inicioBase = evento.inicio ?? evento.data ?? new Date().toISOString();
  const fimCalculado = evento.fim ?? calcularFim(inicioBase, tempo);
  const updatedAt = evento.updatedAt ?? new Date().toISOString();
  const createdAt = evento.createdAt ?? updatedAt;
  const syncId = evento.syncId && evento.syncId.trim() ? evento.syncId : generateSyncId();
  const integrationDate = evento.integrationDate ?? null;
  const sentimentoInicioDb = sanitizeSentimento(evento.sentimentoInicio);
  const sentimentoFimDb = sanitizeSentimento(evento.sentimentoFim);
  const concluidaDb = sanitizeBoolean(evento.concluida, false) ? 1 : 0;

  const resultado = await db.runAsync(
    `INSERT INTO eventos (
      titulo,
      observacao,
      data,
      tipo,
      dificuldade,
      tempoExecucao,
      inicio,
      fim,
      cor,
      googleId,
      outlookId,
      icsUid,
      updatedAt,
      createdAt,
      syncId,
      provider,
      accountId,
      status,
      integrationDate,
      sentimentoInicio,
      sentimentoFim,
      concluida
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evento.titulo,
      evento.observacao ?? "",
      evento.data ?? "",
      evento.tipo,
      evento.dificuldade,
      tempo,
      inicioBase,
      fimCalculado,
      evento.cor ?? DEFAULT_CALENDAR_CATEGORY.color,
      evento.googleId ?? null,
      evento.outlookId ?? null,
      evento.icsUid ?? null,
      updatedAt,
      createdAt,
      syncId,
      evento.provider,
      evento.accountId ?? null,
      evento.status ?? "ativo",
      integrationDate,
      sentimentoInicioDb,
      sentimentoFimDb,
      concluidaDb,
    ]
  );

  if (!options.skipNotify) {
    notifyChange();
  }

  return resultado.lastInsertRowId ?? null;
};

export async function salvarEvento(ev: Evento) {
  return withDatabase((db) => salvarEventoInternal(db, ev));
}

const atualizarEventoInternal = async (
  db: SQLite.SQLiteDatabase,
  ev: Evento,
  options: InternalSaveOptions = {}
) => {
  const evento = normalizarEvento(ev);
  const tempo = sanitizeTempoExecucao(evento.tempoExecucao);
  const inicioBase = evento.inicio ?? evento.data ?? new Date().toISOString();
  const fimCalculado = evento.fim ?? calcularFim(inicioBase, tempo);
  const updatedAt = evento.updatedAt ?? new Date().toISOString();
  let integrationDate: string | null;
  if (evento.integrationDate === undefined) {
    const existente = await db.getFirstAsync<{ integrationDate: string | null }>(
      `SELECT integrationDate FROM eventos WHERE id = ?`,
      [evento.id]
    );
    integrationDate = existente?.integrationDate ?? null;
  } else {
    integrationDate = evento.integrationDate ?? null;
  }

  let cachedFinalizacao:
    | { sentimentoInicio: number | null; sentimentoFim: number | null; concluida: number | null }
    | null = null;

  const ensureFinalizacao = async () => {
    if (!cachedFinalizacao) {
      cachedFinalizacao = await db.getFirstAsync<{
        sentimentoInicio: number | null;
        sentimentoFim: number | null;
        concluida: number | null;
      }>(
        `SELECT sentimentoInicio, sentimentoFim, concluida FROM eventos WHERE id = ?`,
        [evento.id]
      );
    }
    return cachedFinalizacao;
  };

  const sentimentoInicioDb =
    evento.sentimentoInicio === undefined
      ? sanitizeSentimento((await ensureFinalizacao())?.sentimentoInicio)
      : sanitizeSentimento(evento.sentimentoInicio);

  const sentimentoFimDb =
    evento.sentimentoFim === undefined
      ? sanitizeSentimento((await ensureFinalizacao())?.sentimentoFim)
      : sanitizeSentimento(evento.sentimentoFim);

  const concluidaDb = (
    evento.concluida === undefined
      ? sanitizeBoolean((await ensureFinalizacao())?.concluida, false)
      : sanitizeBoolean(evento.concluida, false)
  )
    ? 1
    : 0;

  await db.runAsync(
    `UPDATE eventos
     SET titulo = ?, observacao = ?, data = ?, tipo = ?, dificuldade = ?, tempoExecucao = ?, inicio = ?, fim = ?,
        cor = ?, googleId = ?, outlookId = ?, icsUid = ?, updatedAt = ?, provider = ?, accountId = ?, status = ?,
        integrationDate = ?, syncId = COALESCE(?, syncId), sentimentoInicio = ?, sentimentoFim = ?, concluida = ?
     WHERE id = ?`,
    [
      evento.titulo,
      evento.observacao ?? "",
      evento.data ?? "",
      evento.tipo,
      evento.dificuldade,
      tempo,
      inicioBase,
      fimCalculado,
      evento.cor ?? DEFAULT_CALENDAR_CATEGORY.color,
      evento.googleId ?? null,
      evento.outlookId ?? null,
      evento.icsUid ?? null,
      updatedAt,
      evento.provider,
      evento.accountId ?? null,
      evento.status ?? "ativo",
      integrationDate,
      evento.syncId ?? null,
      sentimentoInicioDb,
      sentimentoFimDb,
      concluidaDb,
      evento.id,
    ]
  );

  if (!options.skipNotify) {
    notifyChange();
  }
};

export async function atualizarEvento(ev: Evento) {
  if (!ev.id) return;

  await withDatabase(async (db) => {
    await atualizarEventoInternal(db, ev);
  });
}

type PomodoroEstadoAtualizacao = {
  stage?: "focus" | "break" | "finished" | null;
  currentCycle?: number | null;
  targetTimestamp?: string | null;
  remainingMs?: number | null;
  paused?: boolean | null;
  awaitingAction?: boolean | null;
  cycleDurations?: number[] | null;
  breakDuration?: number | null;
};

export async function atualizarPomodoroEstado(
  eventoId: number,
  estado: PomodoroEstadoAtualizacao
) {
  if (!eventoId) {
    return;
  }

  const columns: string[] = [];
  const values: any[] = [];

  if (estado.stage !== undefined) {
    const stage =
      estado.stage === null ? null : sanitizePomodoroStage(estado.stage);
    columns.push("pomodoroStage = ?");
    values.push(stage);
  }

  if (estado.currentCycle !== undefined) {
    const current =
      estado.currentCycle === null
        ? null
        : sanitizeNonNegativeInteger(estado.currentCycle);
    columns.push("pomodoroCurrentCycle = ?");
    values.push(current);
  }

  if (estado.targetTimestamp !== undefined) {
    const target =
      estado.targetTimestamp === null
        ? null
        : normalizeToIsoString(estado.targetTimestamp);
    columns.push("pomodoroTargetTimestamp = ?");
    values.push(target);
  }

  if (estado.remainingMs !== undefined) {
    const remaining =
      estado.remainingMs === null
        ? null
        : sanitizeNonNegativeInteger(estado.remainingMs);
    columns.push("pomodoroRemainingMs = ?");
    values.push(remaining);
  }

  if (estado.paused !== undefined) {
    if (estado.paused === null) {
      columns.push("pomodoroPaused = NULL");
    } else {
      columns.push("pomodoroPaused = ?");
      values.push(sanitizeBoolean(estado.paused) ? 1 : 0);
    }
  }

  if (estado.awaitingAction !== undefined) {
    if (estado.awaitingAction === null) {
      columns.push("pomodoroAwaitingAction = NULL");
    } else {
      columns.push("pomodoroAwaitingAction = ?");
      values.push(sanitizeBoolean(estado.awaitingAction) ? 1 : 0);
    }
  }

  if (estado.cycleDurations !== undefined) {
    const sanitizedDurations =
      estado.cycleDurations === null
        ? null
        : sanitizeCycleDurations(estado.cycleDurations);
    columns.push("pomodoroCycleDurations = ?");
    values.push(
      sanitizedDurations && sanitizedDurations.length
        ? JSON.stringify(sanitizedDurations)
        : null
    );
  }

  if (estado.breakDuration !== undefined) {
    const sanitizedBreak =
      estado.breakDuration === null
        ? null
        : sanitizeNonNegativeInteger(estado.breakDuration);
    columns.push("pomodoroBreakDuration = ?");
    values.push(sanitizedBreak);
  }

  if (!columns.length) {
    return;
  }

  const updatedAt = new Date().toISOString();
  columns.push("updatedAt = ?");
  values.push(updatedAt);

  await withDatabase(async (db) => {
    await db.runAsync(
      `UPDATE eventos SET ${columns.join(", ")} WHERE id = ?`,
      [...values, eventoId]
    );
    notifyChange();
  });
}

export async function deletarEvento(id: number) {
  return withDatabase(async (db) => {
    const registro = await db.getFirstAsync<{
      googleId: string | null;
      outlookId: string | null;
      icsUid: string | null;
      accountId: string | null;
      provider: string | null;
    }>(`SELECT googleId, outlookId, icsUid, accountId, provider FROM eventos WHERE id = ?`, [id]);
    const updatedAt = new Date().toISOString();
    await db.runAsync(`UPDATE eventos SET status = ?, updatedAt = ? WHERE id = ?`, [
      "removido",
      updatedAt,
      id,
    ]);
    notifyChange();
    const googleId = registro?.googleId?.trim() ? registro.googleId : null;
    const outlookId = registro?.outlookId?.trim() ? registro.outlookId : null;
    const accountId = registro?.accountId ?? null;
    const provider = (registro?.provider as CalendarProvider | null) ?? null;
    const icsUid = registro?.icsUid?.trim() ? registro.icsUid : null;
    return { googleId, outlookId, icsUid, provider, accountId };
  });
}

const ACTIVE_STATUS_WHERE =
  "WHERE COALESCE(TRIM(LOWER(status)), '') NOT IN ('removido', 'removida', 'concluido', 'concluida', 'cancelado', 'cancelada', 'canceled', 'cancelled', 'excluido', 'excluida', 'deleted', 'done', 'completed')";

export async function buscarEventos(setEventos: (eventos: Evento[]) => void) {
  await withDatabase(async (db) => {
    const result = await db.getAllAsync(
      `SELECT * FROM eventos ${ACTIVE_STATUS_WHERE} ORDER BY inicio ASC`
    );

    setEventos(result.map(mapRowToEvento));
  });
}

export async function listarEventos(): Promise<Evento[]> {
  return withDatabase(async (db) => {
    const result = await db.getAllAsync(
      `SELECT * FROM eventos ${ACTIVE_STATUS_WHERE} ORDER BY inicio ASC`
    );
    return result.map(mapRowToEvento);
  });
}

export async function upsertEventoPorGoogleId(ev: Evento) {
  if (!ev.googleId) {
    return salvarEvento(ev);
  }
  return withDatabase(async (db) => {
    const existente = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM eventos WHERE googleId = ?`,
      [ev.googleId]
    );
    if (existente?.id) {
      await atualizarEventoInternal(db, { ...ev, id: existente.id });
      return existente.id;
    }
    return salvarEventoInternal(db, ev);
  });
}

export async function upsertEventoPorOutlookId(ev: Evento) {
  if (!ev.outlookId) {
    return salvarEvento(ev);
  }
  return withDatabase(async (db) => {
    const existente = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM eventos WHERE outlookId = ?`,
      [ev.outlookId]
    );
    if (existente?.id) {
      await atualizarEventoInternal(db, { ...ev, id: existente.id });
      return existente.id;
    }
    return salvarEventoInternal(db, ev);
  });
}

const upsertEventoPorIcsUidInternal = async (
  db: SQLite.SQLiteDatabase,
  ev: Evento,
  options: InternalSaveOptions = {}
) => {
  if (!ev.icsUid) {
    return salvarEventoInternal(db, ev, options);
  }

  const existente = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM eventos WHERE icsUid = ? AND accountId = ?`,
    [ev.icsUid, ev.accountId ?? null]
  );

  if (existente?.id) {
    await atualizarEventoInternal(db, { ...ev, id: existente.id }, options);
    return existente.id;
  }

  return salvarEventoInternal(db, ev, options);
};

export async function upsertEventoPorIcsUid(ev: Evento) {
  if (!ev.icsUid) {
    return salvarEvento(ev);
  }
  return withDatabase(async (db) => {
    return upsertEventoPorIcsUidInternal(db, ev);
  });
}

export async function atualizarGoogleInfo(
  id: number,
  info: { googleId?: string | null; updatedAt?: string | null }
) {
  const campos: string[] = [];
  const valores: any[] = [];

  if (info.googleId !== undefined) {
    campos.push("googleId = ?");
    valores.push(info.googleId);
  }

  if (info.updatedAt !== undefined) {
    campos.push("updatedAt = ?");
    valores.push(info.updatedAt);
  }

  if (campos.length === 0) {
    return;
  }

  valores.push(id);
  await withDatabase(async (db) => {
    await db.runAsync(`UPDATE eventos SET ${campos.join(", ")} WHERE id = ?`, valores);
    notifyChange();
  });
}

export { dbPromise as db };

export async function removerEventosSincronizados(
  provider: "google" | "outlook" | "ics",
  options: { accountId?: string } = {}
) {
  await withDatabase(async (db) => {
    const column = provider === "google" ? "googleId" : provider === "outlook" ? "outlookId" : "icsUid";
    const updatedAt = new Date().toISOString();
    const params: any[] = [
      "removido",
      updatedAt,
      provider,
    ];
    let query = `UPDATE eventos SET status = ?, updatedAt = ? WHERE provider = ? AND ${column} IS NOT NULL AND TRIM(${column}) <> '' AND (status IS NULL OR TRIM(LOWER(status)) <> 'removido')`;
    if (options.accountId) {
      query += " AND accountId = ?";
      params.push(options.accountId);
    }
    const result = await db.runAsync(query, params);
    if ((result?.changes ?? 0) > 0) {
      notifyChange();
    }
  });
}

const beginTransaction = async (db: SQLite.SQLiteDatabase) => {
  await db.execAsync("BEGIN IMMEDIATE TRANSACTION");
};

const rollbackTransaction = async (db: SQLite.SQLiteDatabase) => {
  try {
    await db.execAsync("ROLLBACK");
  } catch (error) {
    console.warn("[database] rollback failed", error);
  }
};

const commitTransaction = async (db: SQLite.SQLiteDatabase) => {
  await db.execAsync("COMMIT");
};

export async function substituirEventosIcs(
  accountId: string,
  eventos: Evento[]
) {
  await withDatabase(async (db) => {
    await beginTransaction(db);

    try {
      const updatedAt = new Date().toISOString();
      await db.runAsync(
        `UPDATE eventos
         SET status = ?, updatedAt = ?
         WHERE provider = ?
           AND icsUid IS NOT NULL
           AND TRIM(icsUid) <> ''
           AND (status IS NULL OR TRIM(LOWER(status)) <> 'removido')
           AND accountId = ?`,
        ["removido", updatedAt, "ics", accountId]
      );

      for (const evento of eventos) {
        await upsertEventoPorIcsUidInternal(db, evento, { skipNotify: true });
      }

      await commitTransaction(db);
      notifyChange();
    } catch (error) {
      await rollbackTransaction(db);
      throw error;
    }
  });
}

export const subscribeEventoChanges = (listener: () => void) => {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
};

export async function listarEventosAtualizadosDesde(
  updatedAt: string | null | undefined
): Promise<Evento[]> {
  return withDatabase(async (db) => {
    if (updatedAt && updatedAt.trim()) {
      const result = await db.getAllAsync(
        `SELECT * FROM eventos WHERE updatedAt > ? ORDER BY updatedAt ASC`,
        [updatedAt]
      );
      return result.map(mapRowToEvento);
    }
    const result = await db.getAllAsync(
      `SELECT * FROM eventos ORDER BY updatedAt ASC`
    );
    return result.map(mapRowToEvento);
  });
}

export async function encontrarEventoPorSyncId(
  syncId: string
): Promise<Evento | null> {
  if (!syncId || !syncId.trim()) {
    return null;
  }
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync(
      `SELECT * FROM eventos WHERE syncId = ? LIMIT 1`,
      [syncId]
    );
    if (!row) {
      return null;
    }
    return mapRowToEvento(row);
  });
}
