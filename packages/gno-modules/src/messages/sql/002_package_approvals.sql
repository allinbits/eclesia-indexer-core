-- Package approval flow (chains with code_submission_policy = inert): approvers enable or reject parked packages
CREATE TABLE vm_enable_packages
(
    id         BIGSERIAL PRIMARY KEY,
    height     BIGINT      NOT NULL REFERENCES blocks (height),
    tx_hash    TEXT        NOT NULL,
    msg_index  INTEGER     NOT NULL,
    approver   TEXT        NOT NULL,
    pkg_path   TEXT        NOT NULL,
    pkg_hash   TEXT,                                          -- Content hash of the approved sources, hex
    pkg_height BIGINT,                                        -- Submission height recorded when the package was parked
    timestamp  TIMESTAMPTZ NOT NULL
);
CREATE INDEX vm_enable_packages_pkg_path_index ON vm_enable_packages (pkg_path);
CREATE INDEX vm_enable_packages_approver_index ON vm_enable_packages (approver);
CREATE INDEX vm_enable_packages_height_index ON vm_enable_packages (height);

CREATE TABLE vm_reject_packages
(
    id        BIGSERIAL PRIMARY KEY,
    height    BIGINT      NOT NULL REFERENCES blocks (height),
    tx_hash   TEXT        NOT NULL,
    msg_index INTEGER     NOT NULL,
    sender    TEXT        NOT NULL,
    pkg_path  TEXT        NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL
);
CREATE INDEX vm_reject_packages_pkg_path_index ON vm_reject_packages (pkg_path);
CREATE INDEX vm_reject_packages_height_index ON vm_reject_packages (height);
