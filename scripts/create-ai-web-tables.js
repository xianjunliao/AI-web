const mysql = require("mysql2/promise");

const statements = [
  `CREATE TABLE IF NOT EXISTS ai_web_chat_records (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ai_web_configs (
    config_key varchar(128) NOT NULL,
    config_json longtext NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (config_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ai_web_state_store (
    state_key varchar(128) NOT NULL,
    state_json longtext NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (state_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ai_web_storage_events (
    id bigint NOT NULL AUTO_INCREMENT,
    event_type varchar(64) NOT NULL,
    event_json text NULL,
    created_at bigint NOT NULL,
    PRIMARY KEY (id),
    KEY idx_ai_web_storage_events_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ai_web_chat_request_logs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ai_web_chat_jobs (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    connectTimeout: 10000,
  });

  for (const statement of statements) {
    await connection.query(statement);
  }

  const [jobStatusColumns] = await connection.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ai_web_chat_jobs'
       AND COLUMN_NAME = 'status_code'`
  );
  if (!jobStatusColumns.length) {
    await connection.query(
      "ALTER TABLE ai_web_chat_jobs ADD COLUMN status_code int NOT NULL DEFAULT 0 AFTER error_text"
    );
  }

  const [tables] = await connection.query("SHOW TABLES LIKE 'ai_web_%'");
  console.log(JSON.stringify(tables, null, 2));
  await connection.end();
}

main().catch((error) => {
  console.error(error.code || error.message);
  process.exit(1);
});
