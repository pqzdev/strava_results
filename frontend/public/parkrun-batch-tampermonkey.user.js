// ==UserScript==
// @name         Parkrun Batch Scraper (Auto-Inject)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Scrapes parkrun individual athlete histories - click the floating button to start (requires API key)
// @author       Woodstock Results
// @match        https://www.parkrun.com/parkrunner/*/all/*
// @match        https://www.parkrun.com.au/parkrunner/*/all/*
// @match        https://www.parkrun.co.uk/parkrunner/*/all/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'parkrun_batch_scraper_config';
    const EXECUTED_KEY = 'parkrun_scraper_executed_on_page';
    const API_KEY_STORAGE = 'parkrun_scraper_api_key';
    const SCRIPT_URL = 'https://woodstock-results.pages.dev/parkrun-individual-batch-browser.js';

    // Add CSS for the floating button
    GM_addStyle(`
        #parkrun-scraper-button {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            padding: 12px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 25px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #parkrun-scraper-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        #parkrun-scraper-button.active {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            animation: pulse 2s infinite;
        }
        #parkrun-scraper-button.completed {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }
        @keyframes pulse {
            0%, 100% { box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4); }
            50% { box-shadow: 0 4px 25px rgba(245, 87, 108, 0.8); }
        }
    `);

    // Create floating button
    const button = document.createElement('button');
    button.id = 'parkrun-scraper-button';
    button.textContent = '🏃 Start Batch Scraper';
    document.body.appendChild(button);

    // Check if scraper is already running
    const storedConfig = sessionStorage.getItem(STORAGE_KEY);

    if (storedConfig) {
        button.textContent = '🔄 Scraper Running...';
        button.classList.add('active');

        // Add stop button
        button.onclick = function() {
            if (confirm('Stop the batch scraper?')) {
                sessionStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(EXECUTED_KEY);
                button.textContent = '🏃 Start Batch Scraper';
                button.classList.remove('active');
                console.log('✅ Parkrun Batch Scraper stopped');
            }
        };

        // Auto-inject and run on this page
        runScraper();
        return;
    }

    // Get API key from localStorage or prompt user
    function getApiKey() {
        let apiKey = localStorage.getItem(API_KEY_STORAGE);
        if (!apiKey) {
            apiKey = prompt('Enter your Parkrun API Key:\n\n(This will be stored in your browser for future use)');
            if (!apiKey) {
                alert('❌ API Key is required to use the scraper');
                return null;
            }
            localStorage.setItem(API_KEY_STORAGE, apiKey);
        }
        return apiKey;
    }

    // Button click handler - start scraper
    button.onclick = function() {
        const apiKey = getApiKey();
        if (!apiKey) return;

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
            apiKey: apiKey,
            active: true
        };

        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));

        console.log('✅ Parkrun Batch Scraper activated!');
        console.log('Configuration:', config);
        console.log('\nThe scraper will now AUTO-RUN on each parkrun athlete page.');
        console.log('Click the button again to stop.');

        button.textContent = '🔄 Scraper Running...';
        button.classList.add('active');
        button.onclick = function() {
            if (confirm('Stop the batch scraper?')) {
                sessionStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(EXECUTED_KEY);
                button.textContent = '🏃 Start Batch Scraper';
                button.classList.remove('active');
                console.log('✅ Parkrun Batch Scraper stopped');
            }
        };

        // Start scraping immediately
        runScraper();
    };

    function runScraper() {
        const storedConfig = sessionStorage.getItem(STORAGE_KEY);
        if (!storedConfig) return;

        // Configuration exists - check if we should run on this page
        const currentPageUrl = window.location.href.split('?')[0];
        const executedOnPage = sessionStorage.getItem(EXECUTED_KEY);

        console.log('🔍 Checking execution status:');
        console.log('   Current page:', currentPageUrl);
        console.log('   Last executed:', executedOnPage);
        console.log('   Match?', executedOnPage === currentPageUrl);

        if (executedOnPage === currentPageUrl) {
            console.log('⏭️  Scraper already executed on this page, skipping...');
            return;
        }

        console.log('✅ Running scraper on new page:', currentPageUrl);

        // Mark this page as executed
        sessionStorage.setItem(EXECUTED_KEY, currentPageUrl);

        // Load and execute the batch scraper script
        const config = JSON.parse(storedConfig);

        // Build URL with query parameters
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('apiEndpoint', config.apiEndpoint);
        currentUrl.searchParams.set('athletesApiEndpoint', config.athletesApiEndpoint);
        currentUrl.searchParams.set('apiKey', config.apiKey);
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
    }

})();
