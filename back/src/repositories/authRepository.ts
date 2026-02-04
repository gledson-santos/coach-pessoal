import { v4 as uuid } from "uuid";
import { withConnection } from "../db";

type TenantRecord = {
  id: string;
  name: string;
  created_at: Date;
};

type UserRecord = {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  email_verified: number;
  is_admin: number;
  created_at: Date;
  updated_at: Date;
};

type OAuthConfigRecord = {
  id: string;
  tenant_id: string;
  provider: "google" | "microsoft" | "facebook";
  client_id: string;
  client_secret_encrypted: string;
  redirect_uris: string;
  extra: string | null;
  created_at: Date;
  updated_at: Date;
};

type SocialAccountRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: "google" | "microsoft" | "facebook";
  provider_user_id: string;
  email: string | null;
  created_at: Date;
};

type RefreshTokenRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
};

type PasswordResetRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
};

type OAuthStateRecord = {
  id: string;
  tenant_id: string;
  provider: "google" | "microsoft" | "facebook";
  nonce: string;
  redirect_uri: string;
  expires_at: Date;
  created_at: Date;
};

type OAuthLoginCodeRecord = {
  id: string;
  tenant_id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
};

export const authRepository = {
  async createTenant(name: string) {
    const id = uuid();
    await withConnection((conn) =>
      conn.execute("INSERT INTO tenants (id, name) VALUES (?, ?)", [id, name])
    );
    return this.findTenantById(id);
  },
  async findTenantById(id: string): Promise<TenantRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT * FROM tenants WHERE id = ?", [id]);
      const record = (rows as TenantRecord[])[0];
      return record ?? null;
    });
  },
  async createUser(params: {
    tenantId: string;
    email: string;
    passwordHash: string;
    isAdmin?: boolean;
    emailVerified?: boolean;
  }) {
    const id = uuid();
    const { tenantId, email, passwordHash, isAdmin = false, emailVerified = false } = params;
    await withConnection((conn) =>
      conn.execute(
        "INSERT INTO users (id, tenant_id, email, password_hash, is_admin, email_verified) VALUES (?, ?, ?, ?, ?, ?)",
        [id, tenantId, email, passwordHash, isAdmin ? 1 : 0, emailVerified ? 1 : 0]
      )
    );
    return this.findUserById(id);
  },
  async findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT * FROM users WHERE tenant_id = ? AND email = ?", [
        tenantId,
        email,
      ]);
      return (rows as UserRecord[])[0] ?? null;
    });
  },
  async findUserById(id: string): Promise<UserRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT * FROM users WHERE id = ?", [id]);
      return (rows as UserRecord[])[0] ?? null;
    });
  },
  async updateUserPassword(id: string, passwordHash: string) {
    await withConnection((conn) =>
      conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id])
    );
  },
  async markEmailVerified(id: string) {
    await withConnection((conn) =>
      conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", [id])
    );
  },
  async createSocialAccount(params: {
    tenantId: string;
    userId: string;
    provider: "google" | "microsoft" | "facebook";
    providerUserId: string;
    email: string | null;
  }) {
    const id = uuid();
    const { tenantId, userId, provider, providerUserId, email } = params;
    await withConnection((conn) =>
      conn.execute(
        "INSERT INTO social_accounts (id, tenant_id, user_id, provider, provider_user_id, email) VALUES (?, ?, ?, ?, ?, ?)",
        [id, tenantId, userId, provider, providerUserId, email]
      )
    );
    return this.findSocialAccountById(id);
  },
  async findSocialAccountById(id: string): Promise<SocialAccountRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT * FROM social_accounts WHERE id = ?", [id]);
      return (rows as SocialAccountRecord[])[0] ?? null;
    });
  },
  async findSocialAccountByProviderId(params: {
    tenantId: string;
    provider: "google" | "microsoft" | "facebook";
    providerUserId: string;
  }): Promise<SocialAccountRecord | null> {
    const { tenantId, provider, providerUserId } = params;
    return withConnection(async (conn) => {
      const [rows] = await conn.execute(
        "SELECT * FROM social_accounts WHERE tenant_id = ? AND provider = ? AND provider_user_id = ?",
        [tenantId, provider, providerUserId]
      );
      return (rows as SocialAccountRecord[])[0] ?? null;
    });
  },
  async findSocialAccountByUser(params: {
    tenantId: string;
    userId: string;
    provider: "google" | "microsoft" | "facebook";
  }): Promise<SocialAccountRecord | null> {
    const { tenantId, userId, provider } = params;
    return withConnection(async (conn) => {
      const [rows] = await conn.execute(
        "SELECT * FROM social_accounts WHERE tenant_id = ? AND user_id = ? AND provider = ?",
        [tenantId, userId, provider]
      );
      return (rows as SocialAccountRecord[])[0] ?? null;
    });
  },
  async deleteSocialAccount(id: string) {
    await withConnection((conn) => conn.execute("DELETE FROM social_accounts WHERE id = ?", [id]));
  },
  async upsertTenantOAuthConfig(params: {
    tenantId: string;
    provider: "google" | "microsoft" | "facebook";
    clientId: string;
    clientSecretEncrypted: string;
    redirectUris: string[];
    extra: Record<string, unknown> | null;
  }) {
    const { tenantId, provider, clientId, clientSecretEncrypted, redirectUris, extra } = params;
    const existing = await this.getTenantOAuthConfig(tenantId, provider);
    if (existing) {
      await withConnection((conn) =>
        conn.execute(
          "UPDATE tenant_oauth_configs SET client_id = ?, client_secret_encrypted = ?, redirect_uris = ?, extra = ? WHERE id = ?",
          [clientId, clientSecretEncrypted, JSON.stringify(redirectUris), extra ? JSON.stringify(extra) : null, existing.id]
        )
      );
      return this.getTenantOAuthConfig(tenantId, provider);
    }
    const id = uuid();
    await withConnection((conn) =>
      conn.execute(
        "INSERT INTO tenant_oauth_configs (id, tenant_id, provider, client_id, client_secret_encrypted, redirect_uris, extra) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, tenantId, provider, clientId, clientSecretEncrypted, JSON.stringify(redirectUris), extra ? JSON.stringify(extra) : null]
      )
    );
    return this.getTenantOAuthConfig(tenantId, provider);
  },
  async getTenantOAuthConfig(tenantId: string, provider: "google" | "microsoft" | "facebook") {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute(
        "SELECT * FROM tenant_oauth_configs WHERE tenant_id = ? AND provider = ?",
        [tenantId, provider]
      );
      return (rows as OAuthConfigRecord[])[0] ?? null;
    });
  },
  async listTenantOAuthStatus(tenantId: string) {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT provider, client_id FROM tenant_oauth_configs WHERE tenant_id = ?", [
        tenantId,
      ]);
      return rows as { provider: "google" | "microsoft" | "facebook"; client_id: string }[];
    });
  },
  async createRefreshToken(params: { tenantId: string; userId: string; tokenHash: string; expiresAt: Date }) {
    const id = uuid();
    const { tenantId, userId, tokenHash, expiresAt } = params;
    await withConnection((conn) =>
      conn.execute(
        "INSERT INTO refresh_tokens (id, tenant_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
        [id, tenantId, userId, tokenHash, expiresAt]
      )
    );
    return this.findRefreshToken(id);
  },
  async findRefreshToken(id: string): Promise<RefreshTokenRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT * FROM refresh_tokens WHERE id = ?", [id]);
      return (rows as RefreshTokenRecord[])[0] ?? null;
    });
  },
  async findRefreshTokenByHash(tenantId: string, tokenHash: string): Promise<RefreshTokenRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute(
        "SELECT * FROM refresh_tokens WHERE tenant_id = ? AND token_hash = ?",
        [tenantId, tokenHash]
      );
      return (rows as RefreshTokenRecord[])[0] ?? null;
    });
  },
  async revokeRefreshTokensForUser(tenantId: string, userId: string) {
    await withConnection((conn) =>
      conn.execute("UPDATE refresh_tokens SET revoked_at = NOW() WHERE tenant_id = ? AND user_id = ?", [
        tenantId,
        userId,
      ])
    );
  },
  async revokeRefreshTokenById(id: string) {
    await withConnection((conn) =>
      conn.execute("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?", [id])
    );
  },
  async createPasswordResetToken(params: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const id = uuid();
    const { tenantId, userId, tokenHash, expiresAt } = params;
    await withConnection((conn) =>
      conn.execute(
        "INSERT INTO password_reset_tokens (id, tenant_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
        [id, tenantId, userId, tokenHash, expiresAt]
      )
    );
    return id;
  },
  async findPasswordResetByHash(tenantId: string, tokenHash: string): Promise<PasswordResetRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute(
        "SELECT * FROM password_reset_tokens WHERE tenant_id = ? AND token_hash = ?",
        [tenantId, tokenHash]
      );
      return (rows as PasswordResetRecord[])[0] ?? null;
    });
  },
  async markPasswordResetUsed(id: string) {
    await withConnection((conn) =>
      conn.execute("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?", [id])
    );
  },
  async createOAuthState(params: {
    tenantId: string;
    provider: "google" | "microsoft" | "facebook";
    nonce: string;
    redirectUri: string;
    expiresAt: Date;
  }) {
    const id = uuid();
    const { tenantId, provider, nonce, redirectUri, expiresAt } = params;
    await withConnection((conn) =>
      conn.execute(
        "INSERT INTO oauth_states (id, tenant_id, provider, nonce, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, tenantId, provider, nonce, redirectUri, expiresAt]
      )
    );
    return id;
  },
  async findOAuthState(nonce: string): Promise<OAuthStateRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT * FROM oauth_states WHERE nonce = ?", [nonce]);
      return (rows as OAuthStateRecord[])[0] ?? null;
    });
  },
  async deleteOAuthState(id: string) {
    await withConnection((conn) => conn.execute("DELETE FROM oauth_states WHERE id = ?", [id]));
  },
  async createOAuthLoginCode(params: { tenantId: string; userId: string; expiresAt: Date }) {
    const id = uuid();
    const { tenantId, userId, expiresAt } = params;
    await withConnection((conn) =>
      conn.execute("INSERT INTO oauth_login_codes (id, tenant_id, user_id, expires_at) VALUES (?, ?, ?, ?)", [
        id,
        tenantId,
        userId,
        expiresAt,
      ])
    );
    return id;
  },
  async findOAuthLoginCode(id: string): Promise<OAuthLoginCodeRecord | null> {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute("SELECT * FROM oauth_login_codes WHERE id = ?", [id]);
      return (rows as OAuthLoginCodeRecord[])[0] ?? null;
    });
  },
  async deleteOAuthLoginCode(id: string) {
    await withConnection((conn) => conn.execute("DELETE FROM oauth_login_codes WHERE id = ?", [id]));
  },
  async createAuditLog(params: { tenantId: string; userId: string | null; action: string; metadata?: any }) {
    const id = uuid();
    const { tenantId, userId, action, metadata } = params;
    await withConnection((conn) =>
      conn.execute("INSERT INTO audit_logs (id, tenant_id, user_id, action, metadata) VALUES (?, ?, ?, ?, ?)", [
        id,
        tenantId,
        userId,
        action,
        metadata ? JSON.stringify(metadata) : null,
      ])
    );
  },
};
