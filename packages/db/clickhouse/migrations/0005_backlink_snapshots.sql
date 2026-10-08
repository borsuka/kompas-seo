-- Backlink research snapshots (Phase 4). Each fetch writes every row with the same
-- updated_at (= snapshot time), recorded in backlink_summaries.

ALTER TABLE backlinks ADD COLUMN IF NOT EXISTS spam_score Nullable(UInt8) AFTER target_status;

CREATE TABLE IF NOT EXISTS referring_domains
(
    target         LowCardinality(String),
    domain         String,
    backlinks      UInt32,
    dofollow       UInt32,
    rating         UInt8,
    spam_score     Nullable(UInt8),
    first_seen     DateTime('UTC'),
    last_seen      DateTime('UTC'),
    lost_at        Nullable(DateTime('UTC')),
    updated_at     DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (target, domain);

CREATE TABLE IF NOT EXISTS backlink_summaries
(
    target         LowCardinality(String),
    data           String COMMENT 'BacklinkSummary JSON',
    provider       LowCardinality(String),
    updated_at     DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (target, updated_at);
