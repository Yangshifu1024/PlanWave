-- PlanWave 服务端初始结构（MySQL 8.0）
-- 单用户设计：account 至多一行；ops 为全局唯一全序账本。

CREATE TABLE account (
    id CHAR(36) PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE devices (
    device_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NULL,
    last_seen_ms BIGINT NOT NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- oplog：seq 为全局单调全序（唯一定序点）；op_id 唯一保证幂等
CREATE TABLE ops (
    seq BIGINT AUTO_INCREMENT PRIMARY KEY,
    op_id CHAR(36) NOT NULL UNIQUE,
    device_id VARCHAR(64) NOT NULL,
    lamport BIGINT UNSIGNED NOT NULL,
    entity_id CHAR(36) NOT NULL,
    patch JSON NOT NULL,
    client_time_ms BIGINT NOT NULL,
    INDEX idx_ops_entity (entity_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 权威投影（由 push 事务内同步更新；便于快照压缩与服务端观测）
CREATE TABLE projects (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL DEFAULT '',
    color VARCHAR(32) NOT NULL DEFAULT 'gray',
    sort_order DOUBLE NOT NULL DEFAULT 0,
    deleted BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE tasks (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    notes MEDIUMTEXT NOT NULL,
    due_date BIGINT NULL,
    priority INT NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    labels JSON NOT NULL,
    sort_order DOUBLE NOT NULL DEFAULT 0,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    INDEX idx_tasks_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
