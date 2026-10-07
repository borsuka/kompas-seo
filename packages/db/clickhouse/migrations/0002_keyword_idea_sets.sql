-- Which keywords were suggested for which seed (Keyword Explorer). Metrics are joined
-- from `keywords`; this table only records membership and source per seed + locale.
CREATE TABLE IF NOT EXISTS keyword_idea_sets
(
    seed           String,
    location_code  UInt32,
    language_code  LowCardinality(String),
    keyword        String,
    source         LowCardinality(String),
    provider       LowCardinality(String),
    fetched_at     DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY (location_code, language_code, seed, keyword);
