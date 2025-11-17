-- Migration: Add support for individual athlete parkrun scraping
-- This migration adds tracking for individual athlete scraping and data source

-- Add data_source column to parkrun_results
-- Values: 'club' (from consolidated club results) or 'individual' (from athlete page)
ALTER TABLE parkrun_results ADD COLUMN data_source TEXT DEFAULT 'club' CHECK(data_source IN ('club', 'individual'));

-- Create index for data source queries
CREATE INDEX IF NOT EXISTS idx_parkrun_data_source ON parkrun_results(data_source);

-- Create table to track individual athlete scraping
CREATE TABLE IF NOT EXISTS parkrun_athlete_scraping_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parkrun_athlete_id TEXT NOT NULL UNIQUE,
    athlete_name TEXT NOT NULL,
    last_scraped_at INTEGER NOT NULL,
    scrape_count INTEGER DEFAULT 1,
    total_results_found INTEGER DEFAULT 0,
    new_results_added INTEGER DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'pending')),
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_parkrun_athlete_scraping_parkrun_id ON parkrun_athlete_scraping_log(parkrun_athlete_id);
CREATE INDEX IF NOT EXISTS idx_parkrun_athlete_scraping_status ON parkrun_athlete_scraping_log(status);
CREATE INDEX IF NOT EXISTS idx_parkrun_athlete_scraping_last_scraped ON parkrun_athlete_scraping_log(last_scraped_at DESC);
