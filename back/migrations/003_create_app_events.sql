CREATE TABLE IF NOT EXISTS app_events (
  id CHAR(36) NOT NULL,
  title VARCHAR(512) NOT NULL,
  notes TEXT NULL,
  event_date TEXT NULL,
  event_type VARCHAR(255) NOT NULL,
  difficulty VARCHAR(255) NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 15,
  start_at TEXT NULL,
  end_at TEXT NULL,
  color CHAR(7) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'ativo',
  provider VARCHAR(32) NOT NULL DEFAULT 'local',
  account_id VARCHAR(255) NULL,
  google_id VARCHAR(255) NULL,
  outlook_id VARCHAR(255) NULL,
  ics_uid VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_app_events_updated_at ON app_events(updated_at);
