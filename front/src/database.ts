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

  return database;
})();

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

export async function salvarEvento(ev: Evento) {
  const db = await dbPromise;
  const evento = normalizarEvento(ev);
  const tempo = sanitizeTempoExecucao(evento.tempoExecucao);
  const inicioBase = evento.inicio ?? evento.data ?? new Date().toISOString();
  const fimCalculado = evento.fim ?? calcularFim(inicioBase, tempo);
  const updatedAt = evento.updatedAt ?? new Date().toISOString();

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
      provider,
      accountId,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  return resultado.lastInsertRowId ?? null;
}

export async function atualizarEvento(ev: Evento) {
  if (!ev.id) return;

  const db = await dbPromise;
  const evento = normalizarEvento(ev);
  const tempo = sanitizeTempoExecucao(evento.tempoExecucao);
  const inicioBase = evento.inicio ?? evento.data ?? new Date().toISOString();
  const fimCalculado = evento.fim ?? calcularFim(inicioBase, tempo);
  const updatedAt = evento.updatedAt ?? new Date().toISOString();

  await db.runAsync(
    `UPDATE eventos
     SET titulo = ?, observacao = ?, data = ?, tipo = ?, dificuldade = ?, tempoExecucao = ?, inicio = ?, fim = ?,
        cor = ?, googleId = ?, outlookId = ?, icsUid = ?, updatedAt = ?, provider = ?, accountId = ?, status = ?
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
      evento.id,
    ]
  );
}

export async function deletarEvento(id: number) {
  const db = await dbPromise;
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
  const googleId = registro?.googleId?.trim() ? registro.googleId : null;
  const outlookId = registro?.outlookId?.trim() ? registro.outlookId : null;
  const accountId = registro?.accountId ?? null;
  const provider = (registro?.provider as CalendarProvider | null) ?? null;
  const icsUid = registro?.icsUid?.trim() ? registro.icsUid : null;
  return { googleId, outlookId, icsUid, provider, accountId };
}

const ACTIVE_STATUS_WHERE =
  "WHERE COALESCE(TRIM(LOWER(status)), '') NOT IN ('removido', 'removida', 'concluido', 'concluida', 'cancelado', 'cancelada', 'excluido', 'excluida', 'deleted', 'done', 'completed')";

export async function buscarEventos(setEventos: (eventos: Evento[]) => void) {
  const db = await dbPromise;
  const result = await db.getAllAsync(
    `SELECT * FROM eventos ${ACTIVE_STATUS_WHERE} ORDER BY inicio ASC`
  );

  setEventos(result.map(mapRowToEvento));
}

export async function listarEventos(): Promise<Evento[]> {
  const db = await dbPromise;
  const result = await db.getAllAsync(
    `SELECT * FROM eventos ${ACTIVE_STATUS_WHERE} ORDER BY inicio ASC`
  );
  return result.map(mapRowToEvento);
}

export async function upsertEventoPorGoogleId(ev: Evento) {
  if (!ev.googleId) {
    return salvarEvento(ev);
  }
  const db = await dbPromise;
  const existente = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM eventos WHERE googleId = ?`,
    [ev.googleId]
  );
  if (existente?.id) {
    await atualizarEvento({ ...ev, id: existente.id });
    return existente.id;
  }
  return salvarEvento(ev);
}

export async function upsertEventoPorOutlookId(ev: Evento) {
  if (!ev.outlookId) {
    return salvarEvento(ev);
  }
  const db = await dbPromise;
  const existente = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM eventos WHERE outlookId = ?`,
    [ev.outlookId]
  );
  if (existente?.id) {
    await atualizarEvento({ ...ev, id: existente.id });
    return existente.id;
  }
  return salvarEvento(ev);
}

export async function upsertEventoPorIcsUid(ev: Evento) {
  if (!ev.icsUid) {
    return salvarEvento(ev);
  }
  const db = await dbPromise;
  const existente = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM eventos WHERE icsUid = ? AND accountId = ?`,
    [ev.icsUid, ev.accountId ?? null]
  );
  if (existente?.id) {
    await atualizarEvento({ ...ev, id: existente.id });
    return existente.id;
  }
  return salvarEvento(ev);
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
  const db = await dbPromise;
  await db.runAsync(`UPDATE eventos SET ${campos.join(", ")} WHERE id = ?`, valores);
}

export { dbPromise as db };

export async function removerEventosSincronizados(
  provider: "google" | "outlook" | "ics",
  options: { accountId?: string } = {}
) {
  const db = await dbPromise;
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
  await db.runAsync(query, params);
}
