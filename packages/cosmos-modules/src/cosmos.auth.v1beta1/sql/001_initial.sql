-- Accounts table storing all known blockchain addresses
-- This is the foundational table referenced by other modules
CREATE TABLE accounts
(
    address TEXT NOT NULL PRIMARY KEY -- Bech32-encoded account address
);