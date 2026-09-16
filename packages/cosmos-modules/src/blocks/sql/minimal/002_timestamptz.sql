-- Store block times as absolute instants. The previous column type dropped the offset, so the
-- stored value depended on the indexer host's time zone. Existing values are reinterpreted in
-- this session's TimeZone, which is correct when the indexer and the database ran in the same
-- zone (the default for the generated docker-compose setup, where both run in UTC).
ALTER TABLE blocks ALTER COLUMN timestamp TYPE TIMESTAMPTZ;

-- Duplicate of the primary key index
DROP INDEX IF EXISTS block_height_index;
