/**
 * Parkrun Batch Scraper - Bookmarklet Version
 *
 * This version persists across page navigations by storing itself in sessionStorage
 * and re-injecting on each new parkrun page.
 *
 * HOW TO INSTALL AS BOOKMARKLET:
 * 1. Create a new bookmark in your browser
 * 2. Name it "Parkrun Batch Scraper"
 * 3. Copy the minified version from the bottom of this file as the URL
 * 4. Save the bookmark
 *
 * HOW TO USE:
 * 1. Navigate to any parkrun athlete's /all/ page
 * 2. Click the "Parkrun Batch Scraper" bookmarklet
 * 3. Configure mode and delay in the prompt
 * 4. The scraper will run automatically across all athlete pages
 */

(function() {
  // Check if we're on a parkrun page
  if (!window.location.hostname.includes('parkrun.com')) {
    alert('⚠️ This bookmarklet only works on parkrun.com pages');
    return;
  }

  // Check if this is an athlete results page
  if (!window.location.pathname.match(/\/parkrunner\/\d+/)) {
    alert('⚠️ Please navigate to an athlete\'s results page first:\nhttps://www.parkrun.com.au/parkrunner/[ID]/all/');
    return;
  }

  const STORAGE_KEY = 'parkrun_batch_scraper_config';
  const SCRIPT_URL = 'https://woodstock-results.pages.dev/parkrun-individual-batch-browser.js';

  // Check if scraper is already configured (returning from navigation)
  const storedConfig = sessionStorage.getItem(STORAGE_KEY);

  if (!storedConfig) {
    // First run - prompt for configuration
    const mode = confirm('Scraping Mode:\n\nOK = New athletes only\nCancel = All athletes (refresh)') ? 'new' : 'all';
    const delayInput = prompt('Delay between athletes (milliseconds):', '3000');
    const delay = parseInt(delayInput) || 3000;

    if (delay < 1000 || delay > 30000) {
      alert('❌ Delay must be between 1000 and 30000 milliseconds');
      return;
    }

    const apiEndpoint = 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import-individual';
    const athletesApiEndpoint = 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape';

    // Store configuration
    const config = {
      mode,
      delay,
      apiEndpoint,
      athletesApiEndpoint,
      active: true
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));

    console.log('✅ Parkrun Batch Scraper activated!');
    console.log('Configuration:', config);
    console.log('\nThe scraper will now run on each parkrun athlete page.');
    console.log('To stop, run: sessionStorage.removeItem("parkrun_batch_scraper_config")');
  }

  // Load and execute the batch scraper script
  const config = JSON.parse(sessionStorage.getItem(STORAGE_KEY));

  // Build URL with query parameters
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('apiEndpoint', config.apiEndpoint);
  currentUrl.searchParams.set('athletesApiEndpoint', config.athletesApiEndpoint);
  currentUrl.searchParams.set('mode', config.mode);
  currentUrl.searchParams.set('delay', config.delay.toString());
  currentUrl.searchParams.set('autoNavigate', 'true');

  // Update browser URL without reload
  window.history.replaceState({}, '', currentUrl.toString());

  // Inject and execute the scraper script
  const script = document.createElement('script');
  script.src = SCRIPT_URL;
  script.onload = function() {
    console.log('✅ Batch scraper script loaded and executing...');
  };
  script.onerror = function() {
    console.error('❌ Failed to load scraper script from:', SCRIPT_URL);
    alert('Failed to load scraper script. Check console for details.');
  };
  document.head.appendChild(script);

})();

/*
 * BOOKMARKLET VERSION (copy everything below this line as the bookmark URL):
 *
 * javascript:(function(){if(!window.location.hostname.includes('parkrun.com')){alert('⚠️ This bookmarklet only works on parkrun.com pages');return}if(!window.location.pathname.match(/\/parkrunner\/\d+/)){alert('⚠️ Please navigate to an athlete\'s results page first:\nhttps://www.parkrun.com.au/parkrunner/[ID]/all/');return}const STORAGE_KEY='parkrun_batch_scraper_config';const SCRIPT_URL='https://woodstock-results.pages.dev/parkrun-individual-batch-browser.js';const storedConfig=sessionStorage.getItem(STORAGE_KEY);if(!storedConfig){const mode=confirm('Scraping Mode:\n\nOK = New athletes only\nCancel = All athletes (refresh)')?'new':'all';const delayInput=prompt('Delay between athletes (milliseconds):','3000');const delay=parseInt(delayInput)||3000;if(delay<1000||delay>30000){alert('❌ Delay must be between 1000 and 30000 milliseconds');return}const apiEndpoint='https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import-individual';const athletesApiEndpoint='https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape';const config={mode,delay,apiEndpoint,athletesApiEndpoint,active:true};sessionStorage.setItem(STORAGE_KEY,JSON.stringify(config));console.log('✅ Parkrun Batch Scraper activated!');console.log('Configuration:',config);console.log('\nThe scraper will now run on each parkrun athlete page.');console.log('To stop, run: sessionStorage.removeItem("parkrun_batch_scraper_config")')}const config=JSON.parse(sessionStorage.getItem(STORAGE_KEY));const currentUrl=new URL(window.location.href);currentUrl.searchParams.set('apiEndpoint',config.apiEndpoint);currentUrl.searchParams.set('athletesApiEndpoint',config.athletesApiEndpoint);currentUrl.searchParams.set('mode',config.mode);currentUrl.searchParams.set('delay',config.delay.toString());currentUrl.searchParams.set('autoNavigate','true');window.history.replaceState({},'',currentUrl.toString());const script=document.createElement('script');script.src=SCRIPT_URL;script.onload=function(){console.log('✅ Batch scraper script loaded and executing...')};script.onerror=function(){console.error('❌ Failed to load scraper script from:',SCRIPT_URL);alert('Failed to load scraper script. Check console for details.')};document.head.appendChild(script)})();
 */
