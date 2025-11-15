# Fix Admin Access for Tim Cox (Strava ID: 18754232)

## Problem
Tim Cox shows up with the admin checkbox ticked in the UI, but doesn't have actual admin access.

## Root Cause
The migration to grant admin access was only applied to the local database, not production.

## Solution

### Step 1: Check current status in production
```bash
cd workers
npx wrangler d1 execute strava-club-db --remote --file=check-admin.sql
```

This will show you the current admin status for both admins.

### Step 2: Apply the migration to production
```bash
cd workers
npx wrangler d1 migrations apply strava-club-db --remote
```

You may need to authenticate first:
```bash
npx wrangler login
```

Or set your API token:
```bash
export CLOUDFLARE_API_TOKEN=your_token_here
```

### Step 3: Verify it worked
Run the check query again:
```bash
npx wrangler d1 execute strava-club-db --remote --file=check-admin.sql
```

Both users should now show `is_admin = 1`.

### Step 4: Test in the app
1. Ask Tim Cox to log out and log back in
2. They should now see admin features (Bulk Edit button, Admin dashboard access, etc.)

## Alternative: Manual fix (if migration fails)
If the migration doesn't work, you can manually update the database:

```bash
npx wrangler d1 execute strava-club-db --remote --command="UPDATE athletes SET is_admin = 1 WHERE strava_id = 18754232"
```

## Why did this happen?
The migration file `0021_grant_admin_to_18754232.sql` was created and applied locally, but migrations need to be explicitly applied to production using the `--remote` flag.
