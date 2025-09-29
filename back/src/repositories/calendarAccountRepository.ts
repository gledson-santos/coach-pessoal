import { RowDataPacket } from "mysql2";
import { v4 as uuid } from "uuid";
import { withConnection } from "../db";

export type CalendarProvider = "google" | "outlook" | "ics";

export type CalendarAccountRecord = {
  id: string;
  provider: CalendarProvider;
  email: string;
  display_name: string | null;
  color: string;
  scope: string | null;
  tenant_id: string | null;
  external_id: string | null;
  access_token: string | null;
  access_token_expires_at: Date | null;
  refresh_token: string | null;
  ics_url: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

type DbCalendarAccount = CalendarAccountRecord & RowDataPacket;

type UpsertAccountParams = {
  provider: CalendarProvider;
  email: string;
  displayName?: string | null;
  color: string;
  scope?: string | null;
  tenantId?: string | null;
  externalId?: string | null;
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshToken?: string | null;
  icsUrl?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

const parseRawPayload = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
};

const mapRow = (row: DbCalendarAccount): CalendarAccountRecord => ({
  ...row,
  display_name: row.display_name,
  tenant_id: row.tenant_id,
  external_id: row.external_id,
  ics_url: row.ics_url ?? null,
  access_token_expires_at: row.access_token_expires_at ? new Date(row.access_token_expires_at) : null,
  created_at: new Date(row.created_at),
  updated_at: new Date(row.updated_at),
  raw_payload: parseRawPayload(row.raw_payload),
});

export const calendarAccountRepository = {
  async list(): Promise<CalendarAccountRecord[]> {
    return withConnection(async (conn) => {
      const [rows] = await conn.query<DbCalendarAccount[]>(
        "SELECT * FROM calendar_accounts ORDER BY created_at ASC"
      );
      return rows.map(mapRow);
    });
  },

  async findByProviderEmail(provider: CalendarProvider, email: string): Promise<CalendarAccountRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.query<DbCalendarAccount[]>(
        "SELECT * FROM calendar_accounts WHERE provider = ? AND email = ? LIMIT 1",
        [provider, email]
      );
      return rows.length > 0 ? mapRow(rows[0]) : null;
    });
  },

  async findById(id: string): Promise<CalendarAccountRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.query<DbCalendarAccount[]>(
        "SELECT * FROM calendar_accounts WHERE id = ? LIMIT 1",
        [id]
      );
      return rows.length > 0 ? mapRow(rows[0]) : null;
    });
  },

  async upsert(params: UpsertAccountParams): Promise<CalendarAccountRecord> {
    const existing = await this.findByProviderEmail(params.provider, params.email);

    if (existing) {
      await withConnection(async (conn) => {
        await conn.query(
          `UPDATE calendar_accounts
           SET display_name = ?,
               color = ?,
               scope = ?,
               tenant_id = ?,
               external_id = ?,
               access_token = ?,
               access_token_expires_at = ?,
               refresh_token = ?,
               ics_url = ?,
               raw_payload = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            params.displayName ?? existing.display_name,
            params.color,
            params.scope ?? existing.scope,
            params.tenantId ?? existing.tenant_id,
            params.externalId ?? existing.external_id,
            params.accessToken ?? existing.access_token,
            params.accessTokenExpiresAt ?? existing.access_token_expires_at,
            params.refreshToken ?? existing.refresh_token,
            params.icsUrl ?? existing.ics_url,
            params.rawPayload ? JSON.stringify(params.rawPayload) : existing.raw_payload,
            existing.id,
          ]
        );
      });
      const updated = await this.findById(existing.id);
      if (!updated) {
        throw new Error("Failed to fetch updated calendar account");
      }
      return updated;
    }

    const id = uuid();
    await withConnection(async (conn) => {
      await conn.query(
        `INSERT INTO calendar_accounts (
          id, provider, email, display_name, color, scope, tenant_id, external_id,
          access_token, access_token_expires_at, refresh_token, ics_url, raw_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          id,
          params.provider,
          params.email,
          params.displayName ?? null,
          params.color,
          params.scope ?? null,
          params.tenantId ?? null,
          params.externalId ?? null,
          params.accessToken ?? null,
          params.accessTokenExpiresAt ?? null,
          params.refreshToken ?? null,
          params.icsUrl ?? null,
          params.rawPayload ? JSON.stringify(params.rawPayload) : null,
        ]
      );
    });
    const created = await this.findById(id);
    if (!created) {
      throw new Error("Failed to create calendar account");
    }
    return created;
  },

  async updateTokens(id: string, tokens: {
    accessToken?: string | null;
    accessTokenExpiresAt?: Date | null;
    refreshToken?: string | null;
    scope?: string | null;
    rawPayload?: Record<string, unknown> | null;
  }): Promise<void> {
    await withConnection(async (conn) => {
      await conn.query(
        `UPDATE calendar_accounts
         SET access_token = ?,
             access_token_expires_at = ?,
             refresh_token = ?,
             scope = ?,
             raw_payload = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          tokens.accessToken ?? null,
          tokens.accessTokenExpiresAt ?? null,
          tokens.refreshToken ?? null,
          tokens.scope ?? null,
          tokens.rawPayload ? JSON.stringify(tokens.rawPayload) : null,
          id,
        ]
      );
    });
  },

  async updateColor(id: string, color: string): Promise<void> {
    await withConnection(async (conn) => {
      await conn.query(
        `UPDATE calendar_accounts
         SET color = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [color, id]
      );
    });
  },

  async remove(id: string): Promise<void> {
    await withConnection(async (conn) => {
      await conn.query("DELETE FROM calendar_accounts WHERE id = ?", [id]);
    });
  },
};
