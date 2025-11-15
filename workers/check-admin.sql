-- Query to check admin status for specific Strava users
SELECT
  strava_id,
  firstname,
  lastname,
  is_admin,
  CASE
    WHEN is_admin = 1 THEN 'YES - Has Admin'
    WHEN is_admin = 0 THEN 'NO - Not Admin'
    ELSE 'NULL - Not Set'
  END as admin_status
FROM athletes
WHERE strava_id IN (151622, 18754232)
ORDER BY strava_id;
