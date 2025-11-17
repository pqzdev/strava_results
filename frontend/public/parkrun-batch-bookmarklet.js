/**
 * Parkrun Batch Scraper - Bookmarklet Version
 *
 * This version persists across page navigations by storing itself in sessionStorage
 * and auto-executing on each new parkrun page via interval checking.
 *
 * HOW TO INSTALL AS BOOKMARKLET:
 * 1. Create a new bookmark in your browser
 * 2. Name it "Parkrun Batch Scraper"
 * 3. Copy the minified version from the bottom of this file as the URL
 * 4. Save the bookmark
 *
 * HOW TO USE:
 * 1. Navigate to any parkrun athlete's /all/ page
 * 2. Click the "Parkrun Batch Scraper" bookmarklet ONCE
 * 3. Configure mode and delay in the prompt
 * 4. The scraper will run automatically across all athlete pages (no need to click again!)
 * 5. To stop: Open console and run: sessionStorage.removeItem("parkrun_batch_scraper_config")
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
  const EXECUTED_KEY = 'parkrun_scraper_executed_on_page';
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
    console.log('\nThe scraper will now AUTO-RUN on each parkrun athlete page.');
    console.log('You only need to click the bookmarklet ONCE!');
    console.log('To stop, run: sessionStorage.removeItem("parkrun_batch_scraper_config")');

    // Install auto-injection checker
    installAutoInjector();
  }

  // Check if we've already executed on this page
  const currentPageUrl = window.location.href.split('?')[0]; // URL without query params
  const executedOnPage = sessionStorage.getItem(EXECUTED_KEY);

  if (executedOnPage === currentPageUrl) {
    console.log('⏭️  Scraper already executed on this page, skipping...');
    return;
  }

  // Mark this page as executed
  sessionStorage.setItem(EXECUTED_KEY, currentPageUrl);

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

  // Install the auto-injector if not already installed
  if (!window.parkrunAutoInjectorInstalled) {
    installAutoInjector();
  }

  function installAutoInjector() {
    window.parkrunAutoInjectorInstalled = true;

    // Check every 2 seconds if we're on a new parkrun page that needs scraping
    setInterval(function() {
      const config = sessionStorage.getItem(STORAGE_KEY);
      if (!config) {
        // Config was cleared, stop checking
        return;
      }

      // Check if we're on a parkrun athlete page
      if (window.location.hostname.includes('parkrun.com') &&
          window.location.pathname.match(/\/parkrunner\/\d+/)) {

        const currentPageUrl = window.location.href.split('?')[0];
        const executedOnPage = sessionStorage.getItem(EXECUTED_KEY);

        // If this is a new page we haven't scraped yet, re-run the bookmarklet
        if (executedOnPage !== currentPageUrl) {
          console.log('🔄 New parkrun page detected, auto-running scraper...');

          // Create and execute a new script tag with the bookmarklet code
          const bookmarkletScript = document.createElement('script');
          bookmarkletScript.src = SCRIPT_URL;
          bookmarkletScript.setAttribute('data-auto-injected', 'true');

          // Mark page as executed before injecting to prevent double-execution
          sessionStorage.setItem(EXECUTED_KEY, currentPageUrl);

          // Build URL with query parameters
          const parsedConfig = JSON.parse(config);
          const currentUrl = new URL(window.location.href);
          currentUrl.searchParams.set('apiEndpoint', parsedConfig.apiEndpoint);
          currentUrl.searchParams.set('athletesApiEndpoint', parsedConfig.athletesApiEndpoint);
          currentUrl.searchParams.set('mode', parsedConfig.mode);
          currentUrl.searchParams.set('delay', parsedConfig.delay.toString());
          currentUrl.searchParams.set('autoNavigate', 'true');
          window.history.replaceState({}, '', currentUrl.toString());

          document.head.appendChild(bookmarkletScript);
        }
      }
    }, 2000);
  }

})();

/*
 * BOOKMARKLET VERSION (copy everything below this line as the bookmark URL):
 *
 * javascript:(function(){if(!window.location.hostname.includes('parkrun.com')){alert('⚠️ This bookmarklet only works on parkrun.com pages');return}if(!window.location.pathname.match(/\/parkrunner\/\d+/)){alert('⚠️ Please navigate to an athlete\'s results page first:\nhttps://www.parkrun.com.au/parkrunner/[ID]/all/');return}const STORAGE_KEY='parkrun_batch_scraper_config';const EXECUTED_KEY='parkrun_scraper_executed_on_page';const SCRIPT_URL='https://woodstock-results.pages.dev/parkrun-individual-batch-browser.js';const storedConfig=sessionStorage.getItem(STORAGE_KEY);if(!storedConfig){const mode=confirm('Scraping Mode:\n\nOK = New athletes only\nCancel = All athletes (refresh)')?'new':'all';const delayInput=prompt('Delay between athletes (milliseconds):','3000');const delay=parseInt(delayInput)||3000;if(delay<1000||delay>30000){alert('❌ Delay must be between 1000 and 30000 milliseconds');return}const apiEndpoint='https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import-individual';const athletesApiEndpoint='https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape';const config={mode,delay,apiEndpoint,athletesApiEndpoint,active:true};sessionStorage.setItem(STORAGE_KEY,JSON.stringify(config));console.log('✅ Parkrun Batch Scraper activated!');console.log('Configuration:',config);console.log('\nThe scraper will now AUTO-RUN on each parkrun athlete page.');console.log('You only need to click the bookmarklet ONCE!');console.log('To stop, run: sessionStorage.removeItem("parkrun_batch_scraper_config")');installAutoInjector()}const currentPageUrl=window.location.href.split('?')[0];const executedOnPage=sessionStorage.getItem(EXECUTED_KEY);if(executedOnPage===currentPageUrl){console.log('⏭️  Scraper already executed on this page, skipping...');return}sessionStorage.setItem(EXECUTED_KEY,currentPageUrl);const config=JSON.parse(sessionStorage.getItem(STORAGE_KEY));const currentUrl=new URL(window.location.href);currentUrl.searchParams.set('apiEndpoint',config.apiEndpoint);currentUrl.searchParams.set('athletesApiEndpoint',config.athletesApiEndpoint);currentUrl.searchParams.set('mode',config.mode);currentUrl.searchParams.set('delay',config.delay.toString());currentUrl.searchParams.set('autoNavigate','true');window.history.replaceState({},'',currentUrl.toString());const script=document.createElement('script');script.src=SCRIPT_URL;script.onload=function(){console.log('✅ Batch scraper script loaded and executing...')};script.onerror=function(){console.error('❌ Failed to load scraper script from:',SCRIPT_URL);alert('Failed to load scraper script. Check console for details.')};document.head.appendChild(script);if(!window.parkrunAutoInjectorInstalled){installAutoInjector()}function installAutoInjector(){window.parkrunAutoInjectorInstalled=true;setInterval(function(){const config=sessionStorage.getItem(STORAGE_KEY);if(!config){return}if(window.location.hostname.includes('parkrun.com')&&window.location.pathname.match(/\/parkrunner\/\d+/)){const currentPageUrl=window.location.href.split('?')[0];const executedOnPage=sessionStorage.getItem(EXECUTED_KEY);if(executedOnPage!==currentPageUrl){console.log('🔄 New parkrun page detected, auto-running scraper...');const bookmarkletScript=document.createElement('script');bookmarkletScript.src=SCRIPT_URL;bookmarkletScript.setAttribute('data-auto-injected','true');sessionStorage.setItem(EXECUTED_KEY,currentPageUrl);const parsedConfig=JSON.parse(config);const currentUrl=new URL(window.location.href);currentUrl.searchParams.set('apiEndpoint',parsedConfig.apiEndpoint);currentUrl.searchParams.set('athletesApiEndpoint',parsedConfig.athletesApiEndpoint);currentUrl.searchParams.set('mode',parsedConfig.mode);currentUrl.searchParams.set('delay',parsedConfig.delay.toString());currentUrl.searchParams.set('autoNavigate','true');window.history.replaceState({},'',currentUrl.toString());document.head.appendChild(bookmarkletScript)}}},2000)}})();
 */
