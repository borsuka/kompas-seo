-- Google Search Console performance (Phase 5): one row per project, day, query and page.
CREATE TABLE IF NOT EXISTS gsc_daily
(
    project_id     UUID,
    date           Date,
    query          String,
    page           String,
    clicks         UInt32,
    impressions    UInt32,
    ctr            Float32,
    position       Float32,
    synced_at      DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(synced_at)
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, date, query, page);
