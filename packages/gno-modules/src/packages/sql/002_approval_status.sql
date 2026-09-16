-- Approval state of a package. On chains with code_submission_policy = inert (gno.land), a deployment
-- parks the package until an approver enables it; on open chains it is live at once and these stay null.
ALTER TABLE packages ADD COLUMN enabled_height  BIGINT;
ALTER TABLE packages ADD COLUMN enabled_tx_hash TEXT;
ALTER TABLE packages ADD COLUMN enabled_by      TEXT;
ALTER TABLE packages ADD COLUMN pkg_hash        TEXT;    -- Content hash named by the approval, hex
ALTER TABLE packages ADD COLUMN pkg_height      BIGINT;  -- Submission height named by the approval
ALTER TABLE packages ADD COLUMN rejected_height BIGINT;
ALTER TABLE packages ADD COLUMN rejected_tx_hash TEXT;
ALTER TABLE packages ADD COLUMN rejected_by     TEXT;
-- 'enabled' for genesis packages and enabled ones, 'rejected' after a rejection, otherwise 'submitted'
-- (which means parked on an inert chain and live on an open one)
ALTER TABLE packages ADD COLUMN status TEXT GENERATED ALWAYS AS (
    CASE
        WHEN rejected_height IS NOT NULL AND (enabled_height IS NULL OR rejected_height > enabled_height) THEN 'rejected'
        WHEN from_genesis OR enabled_height IS NOT NULL THEN 'enabled'
        ELSE 'submitted'
    END
) STORED;
CREATE INDEX packages_status_index ON packages (status);
