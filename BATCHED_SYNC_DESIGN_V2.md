# WOOD-8: Two-Phase Batched Sync Design (v2)

## Problem
Athletes with 10,000+ activities hit Cloudflare Workers limits:
- 50 subrequest limit per worker invocation
- Previous approach was too complicated (trying to do everything in one batch)

## Solution: Two-Phase Approach

### Phase 1: Race Discovery (Fast & Reliable)
**Goal:** Find all races quickly without fetching details

**Process:**
1. Fetch activity lists from Strava (200 activities per page)
2. Filter for races (workout_type === 1, type === 'Run')
3. Store race metadata WITHOUT polylines/descriptions
4. Process in large batches (1000 activities = ~5 Strava API calls)

**Subrequest Count (per 1000-activity batch):**
- Setup queries: ~10
- Strava activity list fetches: 5 (200 per page)
- Race INSERTs: ~30 (assuming ~3% are races)
- Batch queries: ~3
- **Total: ~48 subrequests** ✓

**Database Schema:**
```sql
-- races table gets new column
ALTER TABLE races ADD COLUMN needs_enrichment INTEGER DEFAULT 0;
```

**Batch Record:**
```sql
-- sync_batches table (already exists)
-- batch_type: 'discovery' or 'enrichment'
ALTER TABLE sync_batches ADD COLUMN batch_type TEXT DEFAULT 'discovery';
```

### Phase 2: Detail Enrichment (Smaller, Targeted)
**Goal:** Fetch polylines/descriptions for races only

**Process:**
1. Find races where needs_enrichment = 1
2. Fetch detailed activity data from Strava (1 API call per race)
3. Update race with polyline/description
4. Process in small batches (15 races per batch)

**Subrequest Count (per 15-race batch):**
- Setup queries: ~5
- Strava detail fetches: 15 (1 per race)
- Race UPDATEs: 15
- **Total: ~35 subrequests** ✓

## Implementation Plan

### 1. Database Migration
```sql
-- Add enrichment tracking
ALTER TABLE races ADD COLUMN needs_enrichment INTEGER DEFAULT 0;
ALTER TABLE sync_batches ADD COLUMN batch_type TEXT DEFAULT 'discovery';
```

### 2. New Files
- `queue/discovery-processor.ts` - Phase 1 batch processor
- `queue/enrichment-processor.ts` - Phase 2 batch processor
- `utils/batch-manager-v2.ts` - Simplified batch management
- `api/admin.ts` - Updated to trigger two-phase sync

### 3. Cron Jobs
- Discovery batches: Processed by existing cron (every minute)
- Enrichment batches: Processed by existing cron (every minute)
- Both use same cron, just different batch_type

### 4. User Flow
1. Admin clicks "Full Refresh" on athlete
2. System creates discovery session with batches
3. Discovery batches process (fast - no detail fetches)
4. When discovery complete, system auto-creates enrichment session
5. Enrichment batches process (slower - fetches details)
6. Both phases have independent retry/error handling

## Benefits

1. **Reliability**
   - Each phase is simple and focused
   - Discovery can't fail due to detail fetching
   - Enrichment failures don't affect race discovery

2. **Performance**
   - Discovery is fast (no detail fetches)
   - Enrichment runs in parallel with other work
   - Can pause/resume enrichment without affecting races

3. **Debuggability**
   - Clear separation of concerns
   - Easy to see which phase failed
   - Can re-run enrichment without re-discovering

4. **Resource Efficiency**
   - Discovery: Large batches (1000 activities)
   - Enrichment: Small batches (15 races)
   - Optimal use of subrequest budget

## Error Handling

### Discovery Phase
- Network error → Retry same batch (don't restart session)
- Rate limit → Pause batch, resume later
- Invalid token → Fail with clear error

### Enrichment Phase
- Detail fetch fails → Mark race as enrichment_failed
- Continue with other races in batch
- Can re-try failed enrichments separately

## Monitoring

### Discovery Progress
- Session ID: abc123
- Type: discovery
- Progress: 5000/10000 activities
- Batches: 3 completed, 2 pending, 0 failed

### Enrichment Progress
- Session ID: def456
- Type: enrichment
- Progress: 150/300 races
- Batches: 10 completed, 5 pending, 0 failed

## Future Enhancements

1. **On-Demand Enrichment**
   - Enrich races only when user views them
   - Lazy-load polylines/descriptions

2. **Parallel Enrichment**
   - Multiple enrichment workers
   - Faster completion for large batches

3. **Incremental Discovery**
   - Only discover new activities
   - Skip already-discovered races
