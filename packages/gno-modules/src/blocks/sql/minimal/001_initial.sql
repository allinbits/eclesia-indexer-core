-- Minimal blocks table: heights and times only
CREATE TABLE blocks
(
    height    BIGINT      PRIMARY KEY, -- Block height
    timestamp TIMESTAMPTZ NOT NULL     -- Block time
);
CREATE INDEX block_time_index ON blocks (timestamp);
