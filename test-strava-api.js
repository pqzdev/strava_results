// Test Strava API directly to see if we can get activities for athlete 14041056

async function testStravaAPI() {
  // We need to get the access token from the database
  // For now, let's construct the URL and see what parameters we're using

  const athleteId = 14041056;
  const afterTimestamp = Math.floor(new Date('2024-01-01').getTime() / 1000);

  console.log('Testing Strava API call for athlete:', athleteId);
  console.log('After timestamp:', afterTimestamp, '(', new Date(afterTimestamp * 1000).toISOString(), ')');

  const url = new URL('https://www.strava.com/api/v3/athlete/activities');
  url.searchParams.set('per_page', '200');
  url.searchParams.set('page', '1');
  url.searchParams.set('after', afterTimestamp.toString());

  console.log('URL that would be called:', url.toString());
  console.log('\nNeed access token from database to actually call API');
  console.log('Run this SQL query in D1:');
  console.log('SELECT access_token, token_expiry FROM athletes WHERE strava_id = 14041056;');
}

testStravaAPI();
