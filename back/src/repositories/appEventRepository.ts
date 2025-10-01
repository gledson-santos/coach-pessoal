import { ResultSetHeader, RowDataPacket } from "mysql2";
import { withConnection } from "../db";

export type AppEventSyncPayload = {
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
};

type DbAppEvent = RowDataPacket & {
  id: string;
  title: string;
  notes: string | null;
  event_date: string | null;
  event_type: string;
  difficulty: string;
  duration_minutes: number;
  start_at: string | null;
  end_at: string | null;
  color: string | null;
  status: string | null;
  provider: string | null;
  account_id: string | null;
  google_id: string | null;
  outlook_id: string | null;
  ics_uid: string | null;
  created_at: Date;
  updated_at: Date;
  integration_date: Date | null;
};

const sanitizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const ensureDuration = (value: unknown, fallback = 15): number => {
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

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

const toSyncPayload = (row: DbAppEvent): AppEventSyncPayload => ({
  id: row.id,
  title: row.title,
  notes: row.notes ?? null,
  date: row.event_date ?? null,
  type: row.event_type,
  difficulty: row.difficulty,
  duration: ensureDuration(row.duration_minutes),
  start: row.start_at ?? null,
  end: row.end_at ?? null,
  color: row.color ?? null,
  status: row.status ?? null,
  provider: row.provider ?? null,
  accountId: row.account_id ?? null,
  googleId: row.google_id ?? null,
  outlookId: row.outlook_id ?? null,
  icsUid: row.ics_uid ?? null,
  updatedAt: row.updated_at ? row.updated_at.toISOString() : new Date().toISOString(),
  createdAt: row.created_at ? row.created_at.toISOString() : null,
  integrationDate: row.integration_date ? row.integration_date.toISOString() : null,
});

export const appEventRepository = {
  async listChangedSince(since: Date | null): Promise<AppEventSyncPayload[]> {
    return withConnection(async (conn) => {
      const query = since
        ? "SELECT * FROM app_events WHERE updated_at > ? ORDER BY updated_at ASC"
        : "SELECT * FROM app_events ORDER BY updated_at ASC";
      const params: any[] = since ? [since] : [];
      const [rows] = await conn.query<DbAppEvent[]>(query, params);
      return rows.map(toSyncPayload);
    });
  },

  async upsertMany(events: AppEventSyncPayload[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    await withConnection(async (conn) => {
      await conn.beginTransaction();
      try {
        for (const event of events) {
          const id = sanitizeString(event.id);
          const title = sanitizeString(event.title) ?? "Evento";
          const eventType = sanitizeString(event.type) ?? "Tarefa";
          const difficulty = sanitizeString(event.difficulty) ?? "Media";
          const notes = sanitizeString(event.notes ?? undefined);
          const date = sanitizeString(event.date ?? undefined);
          const start = sanitizeString(event.start ?? undefined);
          const end = sanitizeString(event.end ?? undefined);
          const color = sanitizeString(event.color ?? undefined);
          const status = sanitizeString(event.status ?? undefined) ?? "ativo";
          const provider = sanitizeString(event.provider ?? undefined) ?? "local";
          const accountId = sanitizeString(event.accountId ?? undefined);
          const googleId = sanitizeString(event.googleId ?? undefined);
          const outlookId = sanitizeString(event.outlookId ?? undefined);
          const icsUid = sanitizeString(event.icsUid ?? undefined);
          const updatedAt = parseDate(event.updatedAt) ?? new Date();
          const createdAt = parseDate(event.createdAt) ?? updatedAt;
          const duration = ensureDuration(event.duration);
          const integrationDate = parseDate(event.integrationDate ?? undefined);

          if (!id) {
            continue;
          }

          await conn.query(
            `INSERT INTO app_events (
              id, title, notes, event_date, event_type, difficulty, duration_minutes,
              start_at, end_at, color, status, provider, account_id, google_id,
              outlook_id, ics_uid, created_at, updated_at, integration_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              title = IF(VALUES(updated_at) > updated_at, VALUES(title), title),
              notes = IF(VALUES(updated_at) > updated_at, VALUES(notes), notes),
              event_date = IF(VALUES(updated_at) > updated_at, VALUES(event_date), event_date),
              event_type = IF(VALUES(updated_at) > updated_at, VALUES(event_type), event_type),
              difficulty = IF(VALUES(updated_at) > updated_at, VALUES(difficulty), difficulty),
              duration_minutes = IF(VALUES(updated_at) > updated_at, VALUES(duration_minutes), duration_minutes),
              start_at = IF(VALUES(updated_at) > updated_at, VALUES(start_at), start_at),
              end_at = IF(VALUES(updated_at) > updated_at, VALUES(end_at), end_at),
              color = IF(VALUES(updated_at) > updated_at, VALUES(color), color),
              status = IF(VALUES(updated_at) > updated_at, VALUES(status), status),
              provider = IF(VALUES(updated_at) > updated_at, VALUES(provider), provider),
              account_id = IF(VALUES(updated_at) > updated_at, VALUES(account_id), account_id),
              google_id = IF(VALUES(updated_at) > updated_at, VALUES(google_id), google_id),
              outlook_id = IF(VALUES(updated_at) > updated_at, VALUES(outlook_id), outlook_id),
              ics_uid = IF(VALUES(updated_at) > updated_at, VALUES(ics_uid), ics_uid),
              updated_at = IF(VALUES(updated_at) > updated_at, VALUES(updated_at), updated_at),
              integration_date = IF(
                VALUES(updated_at) > updated_at,
                VALUES(integration_date),
                integration_date
              )`,
            [
              id,
              title,
              notes,
              date,
              eventType,
              difficulty,
              duration,
              start,
              end,
              color,
              status,
              provider,
              accountId,
              googleId,
              outlookId,
              icsUid,
              createdAt,
              updatedAt,
              integrationDate,
            ]
          );
        }

        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    });
  },

  async listPendingIntegration(limit: number, offset: number): Promise<AppEventSyncPayload[]> {
    return withConnection(async (conn) => {
      const [rows] = await conn.query<DbAppEvent[]>(
        `SELECT * FROM app_events
         WHERE integration_date IS NULL
         ORDER BY updated_at ASC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      return rows.map(toSyncPayload);
    });
  },

  async countPendingIntegration(): Promise<number> {
    return withConnection(async (conn) => {
      const [rows] = await conn.query<(RowDataPacket & { total: number })[]>(
        "SELECT COUNT(*) AS total FROM app_events WHERE integration_date IS NULL"
      );
      const total = rows[0]?.total ?? 0;
      return Number(total) || 0;
    });
  },

  async markIntegrated(ids: string[], integrationDate: Date | null): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    return withConnection(async (conn) => {
      const placeholders = ids.map(() => "?").join(", ");
      const query = `UPDATE app_events SET integration_date = ? WHERE id IN (${placeholders})`;
      const params: any[] = [integrationDate];
      params.push(...ids);
      const [result] = await conn.query<ResultSetHeader>(query, params);
      return result.affectedRows ?? 0;
    });
  },
};
