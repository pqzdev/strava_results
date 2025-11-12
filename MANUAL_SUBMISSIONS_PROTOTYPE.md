# Manual Strava Activity Submission - Prototype Implementation

## Overview

This prototype allows users to manually submit Strava activity links when OAuth authentication is unavailable. The system extracts public data from activity pages, allows review and editing, and submits for admin approval.

## What's Implemented

### Backend (Cloudflare Workers)

**Files Created:**
- `database/migrations/0011_add_manual_submissions.sql` - Database schema
- `workers/src/api/manual-submissions.ts` - API endpoints
- `workers/src/index.ts` - Routes added

**API Endpoints:**
1. `POST /api/manual-submissions/extract` - Extract activity data from URLs/IDs
2. `POST /api/manual-submissions/submit` - Submit activities for review
3. `GET /api/admin/manual-submissions` - Get all submissions (admin)
4. `POST /api/admin/manual-submissions/:id/approve` - Approve submission
5. `POST /api/admin/manual-submissions/:id/reject` - Reject submission

**Key Features:**
- ✅ Flexible input parsing (handles full URLs, dirty URLs, just activity IDs)
- ✅ Duplicate detection (checks races table and pending submissions)
- ✅ Canonical URL building
- ✅ HTML parsing to extract activity data
- ✅ Original + edited values tracking
- ✅ Admin approval workflow

### Frontend (React/TypeScript)

**Files Created:**
- `frontend/src/pages/SubmitActivities.tsx` - Submission form
- `frontend/src/pages/SubmitActivities.css` - Submission form styles
- `frontend/src/pages/SubmitActivitiesReview.tsx` - Review/edit page
- `frontend/src/pages/SubmitActivitiesReview.css` (to be created)

**User Flow:**
1. **Submit** (`/submit-activities`)
   - Paste Strava links (any format)
   - Add to queue (can repeat)
   - Process all queued activities

2. **Review** (`/submit-activities/review`)
   - See extracted data
   - Edit distance/time/elevation
   - Add event name
   - Add notes
   - Navigate between activities
   - Remove unwanted activities
   - Submit all for approval

3. **Admin Review** (to be integrated into `/admin`)
   - View pending submissions
   - See original vs edited values
   - Approve/reject individual or bulk
   - Approved → appears in main dashboard

## Input Flexibility

The system accepts:
```
✓ https://www.strava.com/activities/16440077551
✓ https://www.strava.com/activities/16440077551?foo=bar
✓ www.strava.com/activities/16440077551
✓ strava.com/activities/16440077551
✓ 16440077551
```

Always rebuilds to canonical: `https://www.strava.com/activities/{id}`

## Duplicate Detection

Checks two places:
1. `races` table - already imported activities
2. `manual_submissions` table - pending submissions

Returns error if duplicate found, preventing re-submission.

## What Still Needs to be Done

### High Priority
1. ✅ **Database Migration** - Run migration to create table
2. ⏳ **Review Page CSS** - Create SubmitActivitiesReview.css
3. ⏳ **Admin Integration** - Add manual submissions section to Admin.tsx
4. ⏳ **Router Integration** - Add routes to App.tsx
5. ⏳ **Navigation Links** - Add "Submit Activities" to header/nav
6. ⏳ **AI Event Suggestion** - Use Cloudflare AI to suggest events based on:
   - Activity name
   - Distance
   - Date
   - Existing event names in database

### Medium Priority
7. ⏳ **Better HTML Parsing** - Current regex-based parser is fragile
8. ⏳ **Event Dropdown** - Populate from existing events
9. ⏳ **Time Parser** - Accept "3:24:15" string format
10. ⏳ **Batch Operations** - Select multiple for approval/rejection
11. ⏳ **Success/Error Toasts** - Better UX feedback

### Nice to Have
12. ⏳ **Upload CSV** - Bulk import activity IDs
13. ⏳ **Progress Indicator** - Show extraction progress
14. ⏳ **Activity Preview** - Show mini preview of each queued activity
15. ⏳ **Athlete Linking** - Try to match athlete_name to existing OAuth athletes

## Database Schema

```sql
CREATE TABLE manual_submissions (
  id INTEGER PRIMARY KEY,
  submission_session_id TEXT,
  strava_activity_id INTEGER UNIQUE,
  strava_url TEXT,

  -- Extracted
  athlete_name TEXT,
  activity_name TEXT,
  activity_type TEXT,
  date TEXT,

  -- Original values
  original_distance REAL,
  original_time_seconds INTEGER,
  original_elevation_gain REAL,

  -- Edited values
  edited_distance REAL,
  edited_time_seconds INTEGER,
  edited_elevation_gain REAL,

  -- Classification
  event_name TEXT,

  -- Workflow
  status TEXT DEFAULT 'pending', -- pending/approved/rejected
  submitted_at INTEGER,
  processed_at INTEGER,
  notes TEXT
);

-- races table additions
ALTER TABLE races ADD COLUMN source TEXT DEFAULT 'oauth'; -- oauth/manual
ALTER TABLE races ADD COLUMN manual_submission_id INTEGER;
```

## Testing Checklist

- [ ] Run database migration
- [ ] Test URL extraction with various formats
- [ ] Test duplicate detection
- [ ] Test submission form
- [ ] Test review page editing
- [ ] Test final submission
- [ ] Test admin approval
- [ ] Test admin rejection
- [ ] Verify approved activities appear in dashboard
- [ ] Test error handling

## Next Steps

1. Create `SubmitActivitiesReview.css`
2. Integrate admin review into `Admin.tsx`
3. Add routes to `App.tsx`
4. Add navigation links
5. Run migration
6. Test end-to-end flow
7. Add AI event suggestion
8. Polish UX/UI

## Notes

- Manual submissions don't have `athlete_id` (set to NULL in races table)
- They are identified by `source = 'manual'` and linked via `manual_submission_id`
- No map/polyline data for manual submissions (acceptable limitation)
- Admin approval required to prevent spam/abuse
- Can be extended later with athlete matching logic
