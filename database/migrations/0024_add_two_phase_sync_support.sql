-- WOOD-8: Two-phase batched sync support
-- Phase 1: Discovery (fast race finding)
-- Phase 2: Enrichment (detail fetching)

-- Add enrichment tracking to races
ALTER TABLE races ADD COLUMN needs_enrichment INTEGER DEFAULT 0;

-- Add batch type to sync_batches
ALTER TABLE sync_batches ADD COLUMN batch_type TEXT DEFAULT 'discovery';

-- Index for finding races that need enrichment
CREATE INDEX IF NOT EXISTS idx_races_needs_enrichment ON races(athlete_id, needs_enrichment) WHERE needs_enrichment = 1;

-- Index for finding batches by type
CREATE INDEX IF NOT EXISTS idx_sync_batches_type ON sync_batches(batch_type, status);
