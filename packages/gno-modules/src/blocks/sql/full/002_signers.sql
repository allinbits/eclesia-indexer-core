-- Who signed each transaction, and through which session key if any
ALTER TABLE transactions ADD COLUMN signers TEXT[] NOT NULL DEFAULT '{}';      -- Accounts the messages are signed by; the first pays the fee
ALTER TABLE transactions ADD COLUMN session_address TEXT;                       -- Session key the transaction was signed with, null for a master key
CREATE INDEX transactions_signers_index ON transactions USING GIN (signers);
CREATE INDEX transactions_session_address_index ON transactions (session_address) WHERE session_address IS NOT NULL;
