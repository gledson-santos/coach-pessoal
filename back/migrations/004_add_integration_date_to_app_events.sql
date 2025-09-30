ALTER TABLE app_events
  ADD COLUMN integration_date DATETIME NULL AFTER updated_at;

CREATE INDEX idx_app_events_integration_date ON app_events (integration_date);
