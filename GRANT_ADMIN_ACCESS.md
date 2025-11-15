# Grant Admin Access to Tim Cox (Strava ID: 18754232)

## Current Status
- ✅ Migration file created: `database/migrations/0021_grant_admin_to_18754232.sql`
- ✅ Applied to **local** database
- ❌ **NOT applied to production** database

## The System is Correct
All API endpoints correctly use `athletes.is_admin` as the source of truth:
- ✅ `/api/admin/*` endpoints check `athletes.is_admin`
- ✅ `/api/races/*` admin features check `athletes.is_admin`
- ✅ All other admin endpoints check `athletes.is_admin`

**The only issue is the migration hasn't been applied to production.**

## Apply the Fix

### Option 1: Run the diagnostic script (recommended)
```bash
cd workers
./diagnose-and-fix-admin.sh
```

This script will:
1. Check Tim Cox's current status in production
2. Apply the migration if needed
3. Verify the fix worked

### Option 2: Manual fix
```bash
cd workers

# Authenticate with Cloudflare
npx wrangler login

# Apply all pending migrations to production
npx wrangler d1 migrations apply strava-club-db --remote

# Verify it worked
npx wrangler d1 execute strava-club-db --remote --command="SELECT strava_id, firstname, lastname, is_admin FROM athletes WHERE strava_id = 18754232"
```

Expected output after fix:
```
strava_id  | firstname | lastname | is_admin
18754232   | Tim       | Cox      | 1
```

## After Applying the Fix

1. **Tim Cox needs to refresh their session**:
   - Log out of the application
   - Log back in with Strava
   - Admin features should now work

2. **Verify admin access works**:
   - Tim should see the "Bulk Edit" button on the race results page
   - Tim should be able to access `/admin/athletes` dashboard
   - Tim should be able to edit races, events, etc.

## Why Did This Happen?

Database migrations must be explicitly applied to each environment:
- ✅ Local: `npx wrangler d1 migrations apply strava-club-db --local` (already done)
- ❌ Production: `npx wrangler d1 migrations apply strava-club-db --remote` (needs to be done)

The admin checkbox in the UI likely updated the **local state** optimistically, but the API call to update production failed or was never executed.

## Future: Granting Admin Access

To grant admin access to any user in the future:

1. Create a migration:
   ```sql
   UPDATE athletes SET is_admin = 1 WHERE strava_id = <STRAVA_ID>;
   ```

2. Apply to production:
   ```bash
   npx wrangler d1 migrations apply strava-club-db --remote
   ```

3. Or use the admin dashboard checkbox (if you're already an admin):
   - Go to `/admin/athletes`
   - Find the user
   - Check the "Admin" checkbox
