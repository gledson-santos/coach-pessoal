import * as SQLite from "expo-sqlite";
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
  updatedAt?: string;
  provider?: CalendarProvider | "local";
  accountId?: string | null;
};

const DEFAULT_TEMPO_EXECUCAO = 15;

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
      updatedAt TEXT,
      provider TEXT DEFAULT 'local',
      accountId TEXT
    );
  `);

  await adicionarColuna(database, "tempoExecucao", "INTEGER DEFAULT 15");
  await adicionarColuna(database, "googleId", "TEXT");
  await adicionarColuna(database, "outlookId", "TEXT");
  await adicionarColuna(database, "updatedAt", "TEXT");
  await adicionarColuna(database, "provider", "TEXT DEFAULT 'local'");
  await adicionarColuna(database, "accountId", "TEXT");

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
  tempoExecucao: row.tempoExecucao ?? DEFAULT_TEMPO_EXECUCAO,
  inicio: row.inicio ?? undefined,
  fim: row.fim ?? undefined,
  cor: row.cor ?? undefined,
  googleId: row.googleId ?? undefined,
  outlookId: row.outlookId ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
  provider: (row.provider as CalendarProvider | "local") ?? "local",
  accountId: row.accountId ?? null,
});

const normalizarEvento = (ev: Evento): Evento => ({
  ...ev,
  provider: ev.provider ?? (ev.googleId ? "google" : ev.outlookId ? "outlook" : "local"),
  accountId: ev.accountId ?? null,
});

export async function salvarEvento(ev: Evento) {
  const db = await dbPromise;
  const evento = normalizarEvento(ev);
  const tempo = evento.tempoExecucao ?? DEFAULT_TEMPO_EXECUCAO;
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
      updatedAt,
      provider,
      accountId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evento.titulo,
      evento.observacao ?? "",
      evento.data ?? "",
      evento.tipo,
      evento.dificuldade,
      tempo,
      inicioBase,
      fimCalculado,
      evento.cor ?? "#2a9d8f",
      evento.googleId ?? null,
      evento.outlookId ?? null,
      updatedAt,
      evento.provider,
      evento.accountId ?? null,
    ]
  );

  return resultado.lastInsertRowId ?? null;
}

export async function atualizarEvento(ev: Evento) {
  if (!ev.id) return;

  const db = await dbPromise;
  const evento = normalizarEvento(ev);
  const tempo = evento.tempoExecucao ?? DEFAULT_TEMPO_EXECUCAO;
  const inicioBase = evento.inicio ?? evento.data ?? new Date().toISOString();
  const fimCalculado = evento.fim ?? calcularFim(inicioBase, tempo);
  const updatedAt = evento.updatedAt ?? new Date().toISOString();

  await db.runAsync(
    `UPDATE eventos
     SET titulo = ?, observacao = ?, data = ?, tipo = ?, dificuldade = ?, tempoExecucao = ?, inicio = ?, fim = ?,
         cor = ?, googleId = ?, outlookId = ?, updatedAt = ?, provider = ?, accountId = ?
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
      evento.cor ?? "#2a9d8f",
      evento.googleId ?? null,
      evento.outlookId ?? null,
      updatedAt,
      evento.provider,
      evento.accountId ?? null,
      evento.id,
    ]
  );
}

export async function deletarEvento(id: number) {
  const db = await dbPromise;
  const registro = await db.getFirstAsync<{
    googleId: string | null;
    outlookId: string | null;
    accountId: string | null;
    provider: string | null;
  }>(`SELECT googleId, outlookId, accountId, provider FROM eventos WHERE id = ?`, [id]);
  await db.runAsync(`DELETE FROM eventos WHERE id = ?`, [id]);
  const googleId = registro?.googleId?.trim() ? registro.googleId : null;
  const outlookId = registro?.outlookId?.trim() ? registro.outlookId : null;
  const accountId = registro?.accountId ?? null;
  const provider = (registro?.provider as CalendarProvider | null) ?? null;
  return { googleId, outlookId, provider, accountId };
}

export async function buscarEventos(setEventos: (eventos: Evento[]) => void) {
  const db = await dbPromise;
  const result = await db.getAllAsync(`SELECT * FROM eventos ORDER BY inicio ASC`);

  setEventos(result.map(mapRowToEvento));
}

export async function listarEventos(): Promise<Evento[]> {
  const db = await dbPromise;
  const result = await db.getAllAsync(`SELECT * FROM eventos ORDER BY inicio ASC`);
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
  provider: "google" | "outlook",
  options: { accountId?: string } = {}
) {
  const db = await dbPromise;
  const column = provider === "google" ? "googleId" : "outlookId";
  const params: any[] = [];
  let query = `DELETE FROM eventos WHERE provider = ? AND ${column} IS NOT NULL AND TRIM(${column}) <> ''`;
  params.push(provider);
  if (options.accountId) {
    query += " AND accountId = ?";
    params.push(options.accountId);
  }
  await db.runAsync(query, params);
}
