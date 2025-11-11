-- Migration: Add gender_position column to parkrun_results table
-- This migration adds support for tracking both overall position and gender-specific position

ALTER TABLE parkrun_results ADD COLUMN gender_position INTEGER;

-- Create index for gender position queries
CREATE INDEX IF NOT EXISTS idx_parkrun_gender_position ON parkrun_results(gender_position);
