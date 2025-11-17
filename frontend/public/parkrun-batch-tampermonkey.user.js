// ==UserScript==
// @name         Parkrun Batch Scraper (Auto-Inject)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically scrapes parkrun individual athlete histories across page navigations
// @author       Woodstock Results
// @match        https://www.parkrun.com/parkrunner/*/all/
// @match        https://www.parkrun.com.au/parkrunner/*/all/
// @match        https://www.parkrun.co.uk/parkrunner/*/all/
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'parkrun_batch_scraper_config';
    const EXECUTED_KEY = 'parkrun_scraper_executed_on_page';
    const SCRIPT_URL = 'https://woodstock-results.pages.dev/parkrun-individual-batch-browser.js';

    // Check if scraper is configured
    const storedConfig = sessionStorage.getItem(STORAGE_KEY);

    if (!storedConfig) {
        // Not configured - show setup prompt
        console.log('🏃 Parkrun Batch Scraper detected but not configured');
        console.log('📋 To start scraping, run this in the console:');
        console.log('');
        console.log('startParkrunBatchScraper()');
        console.log('');

        // Expose a global function to start the scraper
        window.startParkrunBatchScraper = function() {
            const mode = confirm('Scraping Mode:\n\nOK = New athletes only\nCancel = All athletes (refresh)') ? 'new' : 'all';
            const delayInput = prompt('Delay between athletes (milliseconds):', '3000');
            const delay = parseInt(delayInput) || 3000;

            if (delay < 1000 || delay > 30000) {
                alert('❌ Delay must be between 1000 and 30000 milliseconds');
                return;
            }

            const config = {
                mode,
                delay,
                apiEndpoint: 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import-individual',
                athletesApiEndpoint: 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape',
                active: true
            };

            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));

            console.log('✅ Parkrun Batch Scraper activated!');
            console.log('Configuration:', config);
            console.log('\nThe scraper will now AUTO-RUN on each parkrun athlete page.');
            console.log('To stop, run: sessionStorage.removeItem("parkrun_batch_scraper_config")');

            // Reload page to start scraping
            window.location.reload();
        };

        return;
    }

    // Configuration exists - check if we should run on this page
    const currentPageUrl = window.location.href.split('?')[0];
    const executedOnPage = sessionStorage.getItem(EXECUTED_KEY);

    if (executedOnPage === currentPageUrl) {
        console.log('⏭️  Scraper already executed on this page, skipping...');
        return;
    }

    // Mark this page as executed
    sessionStorage.setItem(EXECUTED_KEY, currentPageUrl);

    // Load and execute the batch scraper script
    const config = JSON.parse(storedConfig);

    console.log('🔄 Auto-injecting parkrun batch scraper...');

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
    };
    document.head.appendChild(script);

    // Expose stop function
    window.stopParkrunBatchScraper = function() {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(EXECUTED_KEY);
        console.log('✅ Parkrun Batch Scraper stopped');
    };

})();
