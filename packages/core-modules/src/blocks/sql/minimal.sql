
CREATE TABLE blocks
(
    height           BIGINT  UNIQUE PRIMARY KEY,
    timestamp        TIMESTAMP WITHOUT TIME ZONE NOT NULL
);
CREATE INDEX block_height_index ON blocks (height);