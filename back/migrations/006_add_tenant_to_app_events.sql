ALTER TABLE app_events
  ADD COLUMN tenant_id CHAR(36) NULL AFTER id;

CREATE INDEX idx_app_events_tenant_updated_at ON app_events (tenant_id, updated_at);
