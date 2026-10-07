-- Initial analytical schema.
-- Conventions:
--   * Statements are separated by a line ending with `;`.
--   * ReplacingMergeTree tables whose rows are updated in place are NOT partitioned by a
--     mutable column (replacement only happens inside one partition). Time-series tables
--     are partitioned by month of their date column.
--   * Read with FINAL (or argMax) when exact de-duplication matters.

CREATE TABLE IF NOT EXISTS keywords
(
    keyword            String,
    location_code      UInt32,
    language_code      LowCardinality(String),
    volume             UInt32,
    cpc                Nullable(Float32),
    competition        Nullable(Float32),
    competition_level  LowCardinality(String) DEFAULT '',
    kd                 Nullable(UInt8),
    intent             Array(LowCardinality(String)),
    trend              Array(UInt32),
    trend_start        Date,
    serp_features      Array(LowCardinality(String)),
    word_count         UInt8,
    parent_topic       String DEFAULT '',
    traffic_potential  Nullable(UInt32),
    provider           LowCardinality(String),
    updated_at         DateTime64(3, 'UTC'),
    INDEX idx_keyword_ngram keyword TYPE ngrambf_v1(3, 65536, 2, 0) GRANULARITY 1,
    INDEX idx_volume volume TYPE minmax GRANULARITY 4
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (location_code, language_code, keyword);

CREATE TABLE IF NOT EXISTS serp_snapshots
(
    keyword        String,
    location_code  UInt32,
    language_code  LowCardinality(String),
    device         LowCardinality(String),
    date           Date,
    checked_at     DateTime64(3, 'UTC'),
    position       UInt16,
    rank_group     UInt16,
    item_type      LowCardinality(String),
    url            String,
    domain         LowCardinality(String),
    title          String,
    description    String,
    extra          String DEFAULT '' COMMENT 'JSON: PAA questions, AI Overview references, etc.'
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (keyword, location_code, language_code, device, date, checked_at, position);

CREATE TABLE IF NOT EXISTS rank_history
(
    project_id     UUID,
    keyword        String,
    device         LowCardinality(String),
    location_code  UInt32,
    language_code  LowCardinality(String),
    date           Date,
    position       Nullable(UInt16) COMMENT 'NULL = not found within tracked depth',
    url            String DEFAULT '',
    checked_at     DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(checked_at)
PARTITION BY toYYYYMM(date)
ORDER BY (project_id, keyword, device, location_code, language_code, date);

CREATE TABLE IF NOT EXISTS domain_keywords
(
    domain         LowCardinality(String),
    keyword        String,
    location_code  UInt32,
    language_code  LowCardinality(String),
    date           Date,
    position       UInt16,
    url            String,
    volume         UInt32,
    cpc            Nullable(Float32),
    kd             Nullable(UInt8),
    intent         Array(LowCardinality(String)),
    serp_features  Array(LowCardinality(String)),
    est_traffic    Float32,
    updated_at     DateTime64(3, 'UTC'),
    INDEX idx_keyword_ngram keyword TYPE ngrambf_v1(3, 65536, 2, 0) GRANULARITY 1
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(date)
ORDER BY (domain, location_code, language_code, date, keyword);

CREATE TABLE IF NOT EXISTS backlinks
(
    source_url     String,
    source_domain  LowCardinality(String),
    target_url     String,
    target_domain  LowCardinality(String),
    anchor         String,
    rel            LowCardinality(String),
    link_type      LowCardinality(String),
    source_rating  UInt8,
    target_status  Nullable(UInt16),
    first_seen     DateTime('UTC'),
    last_seen      DateTime('UTC'),
    lost_at        Nullable(DateTime('UTC')),
    updated_at     DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (target_domain, source_domain, source_url, target_url, anchor);

CREATE TABLE IF NOT EXISTS domain_metrics
(
    domain           LowCardinality(String),
    date             Date,
    rating           UInt8,
    ref_domains      UInt32,
    backlinks        UInt64,
    est_traffic      Float64,
    keywords_top3    UInt32,
    keywords_top10   UInt32,
    keywords_top100  UInt32,
    rating_source    LowCardinality(String) DEFAULT 'provider' COMMENT 'provider | internal (PageRank)',
    updated_at       DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(date)
ORDER BY (domain, date);

CREATE TABLE IF NOT EXISTS provider_usage
(
    org_id        String,
    provider      LowCardinality(String),
    endpoint      LowCardinality(String),
    cost          Float64 COMMENT 'Provider cost in USD (0 when served from cache)',
    credits       UInt32,
    cached        Bool,
    success       Bool,
    latency_ms    UInt32,
    request_hash  String,
    created_at    DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (org_id, created_at);
