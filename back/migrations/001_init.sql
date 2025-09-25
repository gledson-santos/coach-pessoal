CREATE TABLE IF NOT EXISTS calendar_accounts (
  id CHAR(36) NOT NULL,
  provider ENUM("google", "outlook") NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NULL,
  color CHAR(7) NOT NULL,
  scope TEXT NULL,
  tenant_id VARCHAR(255) NULL,
  external_id VARCHAR(255) NULL,
  access_token TEXT NULL,
  access_token_expires_at DATETIME NULL,
  refresh_token TEXT NULL,
  raw_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_calendar_account_provider_email (provider, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calendar_events (
  id CHAR(36) NOT NULL,
  account_id CHAR(36) NOT NULL,
  provider ENUM("google", "outlook", "local") NOT NULL DEFAULT "local",
  external_id VARCHAR(255) NULL,
  title VARCHAR(512) NOT NULL,
  description TEXT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT "confirmed",
  color CHAR(7) NOT NULL,
  raw_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_calendar_events_account_external (account_id, external_id),
  CONSTRAINT fk_calendar_events_account FOREIGN KEY (account_id) REFERENCES calendar_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
