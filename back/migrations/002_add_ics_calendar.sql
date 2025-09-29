ALTER TABLE calendar_accounts
  MODIFY COLUMN provider ENUM("google", "outlook", "ics") NOT NULL;

ALTER TABLE calendar_accounts
  ADD COLUMN ics_url TEXT NULL AFTER refresh_token;

ALTER TABLE calendar_events
  MODIFY COLUMN provider ENUM("google", "outlook", "ics", "local") NOT NULL DEFAULT "local";
