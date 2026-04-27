const fs = require("fs");
const mysql = require("mysql2/promise");

(async () => {
  const cfg = JSON.parse(fs.readFileSync("data/mysql-config.json", "utf8"));
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: Number(cfg.port || 3306),
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: "utf8mb4",
  });
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ai_web_novel_jobs (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      request_id VARCHAR(128) NOT NULL UNIQUE,
      source VARCHAR(128) NOT NULL DEFAULT '',
      method VARCHAR(12) NOT NULL DEFAULT 'GET',
      path VARCHAR(1024) NOT NULL DEFAULT '',
      request_json LONGTEXT NULL,
      response_json LONGTEXT NULL,
      response_text LONGTEXT NULL,
      content_type VARCHAR(255) NOT NULL DEFAULT 'application/json; charset=utf-8',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      status_code INT NOT NULL DEFAULT 0,
      error_text TEXT NULL,
      attempts INT NOT NULL DEFAULT 0,
      locked_by VARCHAR(128) NULL,
      locked_at BIGINT NULL,
      latency_ms INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      completed_at BIGINT NULL,
      INDEX idx_ai_web_novel_jobs_status_created (status, created_at),
      INDEX idx_ai_web_novel_jobs_request_id (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await conn.end();
  console.log("ai_web_novel_jobs ready");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
