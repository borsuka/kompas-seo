-- Domain research snapshots (Phase 2).

-- Previous position lets "new keywords" be derived from a single snapshot.
ALTER TABLE domain_keywords ADD COLUMN IF NOT EXISTS previous_position Nullable(UInt16) AFTER position;

-- Ranking mode of the row: 'live' (current) or 'lost' (dropped out of the top 100).
ALTER TABLE domain_keywords ADD COLUMN IF NOT EXISTS mode LowCardinality(String) DEFAULT 'live' AFTER date;

-- Provider domain overview per locale and day (totals, history, countries) as JSON.
CREATE TABLE IF NOT EXISTS domain_overviews
(
    domain         LowCardinality(String),
    location_code  UInt32,
    language_code  LowCardinality(String),
    date           Date,
    data           String,
    provider       LowCardinality(String),
    updated_at     DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (domain, location_code, language_code, date);
