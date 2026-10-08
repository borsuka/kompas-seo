-- Rank tracking (Phase 3).

-- Snapshot of volume and SERP features at check time (visibility, traffic) and the
-- SERP volatility of the keyword compared with its previous check (0–10).
ALTER TABLE rank_history ADD COLUMN IF NOT EXISTS volume UInt32 DEFAULT 0 AFTER url;
ALTER TABLE rank_history ADD COLUMN IF NOT EXISTS serp_features Array(LowCardinality(String)) AFTER volume;
ALTER TABLE rank_history ADD COLUMN IF NOT EXISTS volatility Float32 DEFAULT 0 AFTER serp_features;
-- Organic top 10 URLs of the check: the next check's volatility is computed against them.
ALTER TABLE rank_history ADD COLUMN IF NOT EXISTS top_urls Array(String) AFTER volatility;

-- Positions of the project's competitors in the same checks (share of voice, comparisons).
CREATE TABLE IF NOT EXISTS rank_competitor_history
(
    project_id     UUID,
    keyword        String,
    device         LowCardinality(String),
    location_code  UInt32,
    language_code  LowCardinality(String),
    date           Date,
    domain         LowCardinality(String),
    position       Nullable(UInt16) COMMENT 'NULL = not found within tracked depth',
    url            String DEFAULT '',
    checked_at     DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(checked_at)
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, keyword, device, location_code, language_code, domain, date);
