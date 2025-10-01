"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarAccountRepository = void 0;
const uuid_1 = require("uuid");
const db_1 = require("../db");
const parseRawPayload = (value) => {
    if (!value) {
        return null;
    }
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    if (typeof value === "object") {
        return value;
    }
    return null;
};
const mapRow = (row) => ({
    ...row,
    display_name: row.display_name,
    tenant_id: row.tenant_id,
    external_id: row.external_id,
    access_token_expires_at: row.access_token_expires_at ? new Date(row.access_token_expires_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    raw_payload: parseRawPayload(row.raw_payload),
});
exports.calendarAccountRepository = {
    async list() {
        return (0, db_1.withConnection)(async (conn) => {
            const [rows] = await conn.query("SELECT * FROM calendar_accounts ORDER BY created_at ASC");
            return rows.map(mapRow);
        });
    },
    async findByProviderEmail(provider, email) {
        return (0, db_1.withConnection)(async (conn) => {
            const [rows] = await conn.query("SELECT * FROM calendar_accounts WHERE provider = ? AND email = ? LIMIT 1", [provider, email]);
            return rows.length > 0 ? mapRow(rows[0]) : null;
        });
    },
    async findById(id) {
        return (0, db_1.withConnection)(async (conn) => {
            const [rows] = await conn.query("SELECT * FROM calendar_accounts WHERE id = ? LIMIT 1", [id]);
            return rows.length > 0 ? mapRow(rows[0]) : null;
        });
    },
    async upsert(params) {
        const existing = await this.findByProviderEmail(params.provider, params.email);
        if (existing) {
            await (0, db_1.withConnection)(async (conn) => {
                await conn.query(`UPDATE calendar_accounts
           SET display_name = ?,
               color = ?,
               scope = ?,
               tenant_id = ?,
               external_id = ?,
               access_token = ?,
               access_token_expires_at = ?,
               refresh_token = ?,
               raw_payload = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`, [
                    params.displayName ?? existing.display_name,
                    params.color,
                    params.scope ?? existing.scope,
                    params.tenantId ?? existing.tenant_id,
                    params.externalId ?? existing.external_id,
                    params.accessToken ?? existing.access_token,
                    params.accessTokenExpiresAt ?? existing.access_token_expires_at,
                    params.refreshToken ?? existing.refresh_token,
                    params.rawPayload ? JSON.stringify(params.rawPayload) : existing.raw_payload,
                    existing.id,
                ]);
            });
            const updated = await this.findById(existing.id);
            if (!updated) {
                throw new Error("Failed to fetch updated calendar account");
            }
            return updated;
        }
        const id = (0, uuid_1.v4)();
        await (0, db_1.withConnection)(async (conn) => {
            await conn.query(`INSERT INTO calendar_accounts (
          id, provider, email, display_name, color, scope, tenant_id, external_id,
          access_token, access_token_expires_at, refresh_token, raw_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
                params.rawPayload ? JSON.stringify(params.rawPayload) : null,
            ]);
        });
        const created = await this.findById(id);
        if (!created) {
            throw new Error("Failed to create calendar account");
        }
        return created;
    },
    async updateTokens(id, tokens) {
        await (0, db_1.withConnection)(async (conn) => {
            await conn.query(`UPDATE calendar_accounts
         SET access_token = ?,
             access_token_expires_at = ?,
             refresh_token = ?,
             scope = ?,
             raw_payload = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`, [
                tokens.accessToken ?? null,
                tokens.accessTokenExpiresAt ?? null,
                tokens.refreshToken ?? null,
                tokens.scope ?? null,
                tokens.rawPayload ? JSON.stringify(tokens.rawPayload) : null,
                id,
            ]);
        });
    },
    async updateColor(id, color) {
        await (0, db_1.withConnection)(async (conn) => {
            await conn.query(`UPDATE calendar_accounts
         SET color = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`, [color, id]);
        });
    },
    async remove(id) {
        await (0, db_1.withConnection)(async (conn) => {
            await conn.query("DELETE FROM calendar_accounts WHERE id = ?", [id]);
        });
    },
};
