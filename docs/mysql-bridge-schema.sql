-- AI-web / life MySQL bridge schema.
-- Safe to run repeatedly. Only creates ai_web_* tables.
-- Recommended MySQL version: 5.7+ / 8.x, charset utf8mb4.

CREATE TABLE IF NOT EXISTS ai_web_chat_records (
  id varchar(96) NOT NULL,
  title varchar(255) NOT NULL DEFAULT '',
  model varchar(255) NOT NULL DEFAULT '',
  assistant_name varchar(255) NOT NULL DEFAULT '',
  user_name varchar(255) NOT NULL DEFAULT '',
  messages_json longtext NOT NULL,
  metadata_json text NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint NULL,
  PRIMARY KEY (id),
  KEY idx_ai_web_chat_updated_at (updated_at),
  KEY idx_ai_web_chat_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_web_configs (
  config_key varchar(128) NOT NULL,
  config_json longtext NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_web_state_store (
  state_key varchar(128) NOT NULL,
  state_json longtext NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (state_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_web_storage_events (
  id bigint NOT NULL AUTO_INCREMENT,
  event_type varchar(64) NOT NULL,
  event_json text NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ai_web_storage_events_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_web_chat_request_logs (
  id bigint NOT NULL AUTO_INCREMENT,
  request_id varchar(96) NOT NULL,
  source varchar(128) NOT NULL DEFAULT '',
  model varchar(255) NOT NULL DEFAULT '',
  user_text text NULL,
  assistant_text mediumtext NULL,
  request_json longtext NOT NULL,
  response_json longtext NULL,
  status_code int NOT NULL DEFAULT 0,
  error_text text NULL,
  latency_ms int NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_web_chat_request_id (request_id),
  KEY idx_ai_web_chat_request_created_at (created_at),
  KEY idx_ai_web_chat_request_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_web_chat_jobs (
  id bigint NOT NULL AUTO_INCREMENT,
  request_id varchar(96) NOT NULL,
  source varchar(128) NOT NULL DEFAULT '',
  model varchar(255) NOT NULL DEFAULT '',
  request_json longtext NOT NULL,
  response_json longtext NULL,
  user_text text NULL,
  assistant_text mediumtext NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  error_text text NULL,
  status_code int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  locked_by varchar(128) NULL,
  locked_at bigint NULL,
  latency_ms int NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_web_chat_jobs_request_id (request_id),
  KEY idx_ai_web_chat_jobs_status_created (status, created_at),
  KEY idx_ai_web_chat_jobs_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_web_novel_jobs (
  id bigint NOT NULL AUTO_INCREMENT,
  request_id varchar(128) NOT NULL,
  source varchar(128) NOT NULL DEFAULT '',
  method varchar(12) NOT NULL DEFAULT 'GET',
  path varchar(1024) NOT NULL DEFAULT '',
  request_json longtext NULL,
  response_json longtext NULL,
  response_text longtext NULL,
  content_type varchar(255) NOT NULL DEFAULT 'application/json; charset=utf-8',
  status varchar(32) NOT NULL DEFAULT 'pending',
  status_code int NOT NULL DEFAULT 0,
  error_text text NULL,
  attempts int NOT NULL DEFAULT 0,
  locked_by varchar(128) NULL,
  locked_at bigint NULL,
  latency_ms int NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  completed_at bigint NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_web_novel_jobs_request_id (request_id),
  KEY idx_ai_web_novel_jobs_status_created (status, created_at),
  KEY idx_ai_web_novel_jobs_request_id (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
