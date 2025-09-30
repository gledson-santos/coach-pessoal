import * as SQLite from "expo-sqlite";
import { DEFAULT_CALENDAR_CATEGORY, normalizeCalendarColor } from "./constants/calendarCategories";
import { CalendarProvider } from "./types/calendar";

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
      status TEXT DEFAULT 'ativo'
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

const mapRowToEvento = (row: any): Evento => ({
  id: row.id,
  titulo: row.titulo,
  observacao: row.observacao ?? undefined,
  data: row.data ?? undefined,
  tipo: row.tipo,
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
});

const normalizarEvento = (ev: Evento): Evento => {
  const provider =
    ev.provider ??
    (ev.googleId ? "google" : ev.outlookId ? "outlook" : ev.icsUid ? "ics" : "local");
  const accountId = ev.accountId ?? null;
  const status = ev.status ?? "ativo";
  const cor = normalizeCalendarColor(ev.cor);
  const tempoExecucao = sanitizeTempoExecucao(ev.tempoExecucao);
  return {
    ...ev,
    provider,
    accountId,
    status,
    cor,
    tempoExecucao,
  };
};

const salvarEventoInternal = async (
  db: SQLite.SQLiteDatabase,
  ev: Evento
) => {
  const evento = normalizarEvento(ev);
  const tempo = sanitizeTempoExecucao(evento.tempoExecucao);
  const inicioBase = evento.inicio ?? evento.data ?? new Date().toISOString();
  const fimCalculado = evento.fim ?? calcularFim(inicioBase, tempo);
  const updatedAt = evento.updatedAt ?? new Date().toISOString();
  const createdAt = evento.createdAt ?? updatedAt;
  const syncId = evento.syncId && evento.syncId.trim() ? evento.syncId : generateSyncId();

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
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  notifyChange();

  return resultado.lastInsertRowId ?? null;
};

export async function salvarEvento(ev: Evento) {
  return withDatabase((db) => salvarEventoInternal(db, ev));
}

const atualizarEventoInternal = async (
  db: SQLite.SQLiteDatabase,
  ev: Evento
) => {
  const evento = normalizarEvento(ev);
  const tempo = sanitizeTempoExecucao(evento.tempoExecucao);
  const inicioBase = evento.inicio ?? evento.data ?? new Date().toISOString();
  const fimCalculado = evento.fim ?? calcularFim(inicioBase, tempo);
  const updatedAt = evento.updatedAt ?? new Date().toISOString();

  await db.runAsync(
    `UPDATE eventos
     SET titulo = ?, observacao = ?, data = ?, tipo = ?, dificuldade = ?, tempoExecucao = ?, inicio = ?, fim = ?,
        cor = ?, googleId = ?, outlookId = ?, icsUid = ?, updatedAt = ?, provider = ?, accountId = ?, status = ?,
        syncId = COALESCE(?, syncId)
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
      evento.syncId ?? null,
      evento.id,
    ]
  );

  notifyChange();
};

export async function atualizarEvento(ev: Evento) {
  if (!ev.id) return;

  await withDatabase(async (db) => {
    await atualizarEventoInternal(db, ev);
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
  "WHERE COALESCE(TRIM(LOWER(status)), '') NOT IN ('removido', 'removida', 'concluido', 'concluida', 'cancelado', 'cancelada', 'excluido', 'excluida', 'deleted', 'done', 'completed')";

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

export async function upsertEventoPorIcsUid(ev: Evento) {
  if (!ev.icsUid) {
    return salvarEvento(ev);
  }
  return withDatabase(async (db) => {
    const existente = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM eventos WHERE icsUid = ? AND accountId = ?`,
      [ev.icsUid, ev.accountId ?? null]
    );
    if (existente?.id) {
      await atualizarEventoInternal(db, { ...ev, id: existente.id });
      return existente.id;
    }
    return salvarEventoInternal(db, ev);
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
