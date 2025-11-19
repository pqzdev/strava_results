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

    // Add CSS for the floating button and modal
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

        /* Modal styles */
        #parkrun-scraper-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #parkrun-scraper-modal .modal-content {
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            max-width: 400px;
            width: 90%;
        }
        #parkrun-scraper-modal h3 {
            margin: 0 0 16px 0;
            font-size: 18px;
            color: #333;
        }
        #parkrun-scraper-modal .radio-group {
            margin-bottom: 16px;
        }
        #parkrun-scraper-modal .radio-option {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            margin: 6px 0;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        #parkrun-scraper-modal .radio-option:hover {
            border-color: #667eea;
            background: #f8f9ff;
        }
        #parkrun-scraper-modal .radio-option.selected {
            border-color: #667eea;
            background: #f0f3ff;
        }
        #parkrun-scraper-modal .radio-option input {
            margin-right: 10px;
        }
        #parkrun-scraper-modal .radio-option label {
            cursor: pointer;
            flex: 1;
            font-size: 14px;
            color: #333;
        }
        #parkrun-scraper-modal .delay-input {
            margin-bottom: 16px;
        }
        #parkrun-scraper-modal .delay-input label {
            display: block;
            margin-bottom: 6px;
            font-size: 14px;
            color: #555;
        }
        #parkrun-scraper-modal .delay-input input {
            width: 100%;
            padding: 10px 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            box-sizing: border-box;
        }
        #parkrun-scraper-modal .delay-input input:focus {
            outline: none;
            border-color: #667eea;
        }
        #parkrun-scraper-modal .button-group {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        #parkrun-scraper-modal button {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        #parkrun-scraper-modal .btn-cancel {
            background: #f0f0f0;
            color: #666;
        }
        #parkrun-scraper-modal .btn-cancel:hover {
            background: #e0e0e0;
        }
        #parkrun-scraper-modal .btn-start {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        #parkrun-scraper-modal .btn-start:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        /* Progress panel styles */
        #parkrun-progress-panel {
            position: fixed;
            bottom: 70px;
            right: 20px;
            z-index: 9998;
            width: 320px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: none;
            overflow: hidden;
        }
        #parkrun-progress-panel .panel-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 16px;
            font-weight: 600;
            font-size: 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #parkrun-progress-panel .panel-header .btn-stop {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: white;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        #parkrun-progress-panel .panel-header .btn-stop:hover {
            background: rgba(255, 255, 255, 0.3);
        }
        #parkrun-progress-panel .panel-body {
            padding: 12px 16px;
        }
        #parkrun-progress-panel .progress-stats {
            display: flex;
            gap: 12px;
            margin-bottom: 12px;
        }
        #parkrun-progress-panel .stat {
            flex: 1;
            text-align: center;
            padding: 8px;
            background: #f5f5f5;
            border-radius: 6px;
        }
        #parkrun-progress-panel .stat-value {
            font-size: 18px;
            font-weight: 700;
            color: #333;
        }
        #parkrun-progress-panel .stat-label {
            font-size: 10px;
            color: #666;
            text-transform: uppercase;
        }
        #parkrun-progress-panel .stat.success .stat-value {
            color: #10b981;
        }
        #parkrun-progress-panel .stat.error .stat-value {
            color: #ef4444;
        }
        #parkrun-progress-panel .current-athlete {
            margin-bottom: 12px;
            padding: 10px;
            background: #f0f3ff;
            border-radius: 6px;
            font-size: 13px;
        }
        #parkrun-progress-panel .current-athlete-label {
            font-size: 10px;
            color: #666;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        #parkrun-progress-panel .current-athlete-name {
            font-weight: 600;
            color: #333;
            word-break: break-word;
        }
        #parkrun-progress-panel .log-messages {
            max-height: 100px;
            overflow-y: auto;
            font-size: 11px;
            font-family: monospace;
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 8px;
            border-radius: 6px;
        }
        #parkrun-progress-panel .log-message {
            margin-bottom: 4px;
            line-height: 1.4;
        }
        #parkrun-progress-panel .log-message.success {
            color: #4ade80;
        }
        #parkrun-progress-panel .log-message.error {
            color: #f87171;
        }
        #parkrun-progress-panel .log-message.info {
            color: #60a5fa;
        }
    `);

    // Create floating button
    const button = document.createElement('button');
    button.id = 'parkrun-scraper-button';
    button.textContent = '🏃 Start Batch Scraper';
    document.body.appendChild(button);

    // Create progress panel
    const progressPanel = document.createElement('div');
    progressPanel.id = 'parkrun-progress-panel';
    progressPanel.innerHTML = `
        <div class="panel-header">
            <span>Scraper Progress</span>
            <button class="btn-stop">Stop</button>
        </div>
        <div class="panel-body">
            <div class="progress-stats">
                <div class="stat">
                    <div class="stat-value" id="progress-current">0</div>
                    <div class="stat-label">Current</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="progress-total">0</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat success">
                    <div class="stat-value" id="progress-success">0</div>
                    <div class="stat-label">Success</div>
                </div>
                <div class="stat error">
                    <div class="stat-value" id="progress-errors">0</div>
                    <div class="stat-label">Errors</div>
                </div>
            </div>
            <div class="current-athlete">
                <div class="current-athlete-label">Current Athlete</div>
                <div class="current-athlete-name" id="current-athlete-name">Starting...</div>
            </div>
            <div class="log-messages" id="log-messages"></div>
        </div>
    `;
    document.body.appendChild(progressPanel);

    // Stop button handler
    progressPanel.querySelector('.btn-stop').addEventListener('click', () => {
        addLogMessage('Scraper stopped by user', 'error');
        stopScraper();
    });

    // Global API for the browser script to update progress
    window.parkrunScraperProgress = {
        show: function() {
            progressPanel.style.display = 'block';
        },
        hide: function() {
            progressPanel.style.display = 'none';
        },
        update: function(data) {
            if (data.current !== undefined) {
                document.getElementById('progress-current').textContent = data.current;
            }
            if (data.total !== undefined) {
                document.getElementById('progress-total').textContent = data.total;
            }
            if (data.success !== undefined) {
                document.getElementById('progress-success').textContent = data.success;
            }
            if (data.errors !== undefined) {
                document.getElementById('progress-errors').textContent = data.errors;
            }
            if (data.athleteName !== undefined) {
                document.getElementById('current-athlete-name').textContent = data.athleteName;
            }
        },
        log: function(message, type = 'info') {
            addLogMessage(message, type);
        }
    };

    function addLogMessage(message, type = 'info') {
        const logContainer = document.getElementById('log-messages');
        const msgElement = document.createElement('div');
        msgElement.className = `log-message ${type}`;
        msgElement.textContent = message;
        logContainer.appendChild(msgElement);
        logContainer.scrollTop = logContainer.scrollHeight;

        // Keep only last 50 messages
        while (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }

    // Function to reset button to start state
    function resetButtonToStart() {
        button.textContent = '🏃 Start Batch Scraper';
        button.classList.remove('active');
        progressPanel.style.display = 'none';
        button.onclick = function() {
            const apiKey = getApiKey();
            if (!apiKey) return;
            showConfigModal(apiKey);
        };
    }

    // Function to stop the scraper
    function stopScraper() {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(EXECUTED_KEY);
        sessionStorage.removeItem('parkrun_batch_scraper_stats');
        resetButtonToStart();
        console.log('✅ Parkrun Batch Scraper stopped');
    }

    // Check if scraper is already running
    const storedConfig = sessionStorage.getItem(STORAGE_KEY);

    if (storedConfig) {
        button.textContent = '🔄 Scraper Running...';
        button.classList.add('active');
        progressPanel.style.display = 'block';

        // Load stats from session storage
        const stats = JSON.parse(sessionStorage.getItem('parkrun_batch_scraper_stats') || '{"successful":0,"failed":0}');
        window.parkrunScraperProgress.update({
            success: stats.successful,
            errors: stats.failed
        });

        // Add stop button
        button.onclick = function() {
            if (confirm('Stop the batch scraper?')) {
                stopScraper();
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

    // Show modal dialog for scraper configuration
    function showConfigModal(apiKey) {
        // Get current athlete ID from URL for "only this" option
        const urlMatch = window.location.pathname.match(/\/parkrunner\/(\d+)/);
        const currentAthleteId = urlMatch ? urlMatch[1] : null;

        // Create modal
        const modal = document.createElement('div');
        modal.id = 'parkrun-scraper-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Parkrun Batch Scraper</h3>
                <div class="radio-group">
                    <div class="radio-option selected" data-value="all">
                        <input type="radio" name="scrape-mode" id="mode-all" value="all" checked>
                        <label for="mode-all">All athletes (refresh all)</label>
                    </div>
                    <div class="radio-option" data-value="new">
                        <input type="radio" name="scrape-mode" id="mode-new" value="new">
                        <label for="mode-new">New athletes only</label>
                    </div>
                    <div class="radio-option" data-value="single">
                        <input type="radio" name="scrape-mode" id="mode-single" value="single">
                        <label for="mode-single">Only this parkrunner${currentAthleteId ? ` (${currentAthleteId})` : ''}</label>
                    </div>
                </div>
                <div class="delay-input">
                    <label for="delay-ms">Delay between athletes (ms)</label>
                    <input type="number" id="delay-ms" value="3000" min="1000" max="30000">
                </div>
                <div class="button-group">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-start">Start</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Handle radio option clicks
        const radioOptions = modal.querySelectorAll('.radio-option');
        radioOptions.forEach(option => {
            option.addEventListener('click', () => {
                radioOptions.forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                option.querySelector('input').checked = true;
            });
        });

        // Handle cancel
        modal.querySelector('.btn-cancel').addEventListener('click', () => {
            modal.remove();
            console.log('❌ Scraper cancelled');
        });

        // Handle start
        modal.querySelector('.btn-start').addEventListener('click', () => {
            const selectedMode = modal.querySelector('input[name="scrape-mode"]:checked').value;
            const delay = parseInt(modal.querySelector('#delay-ms').value) || 3000;

            if (delay < 1000 || delay > 30000) {
                alert('❌ Delay must be between 1000 and 30000 milliseconds');
                return;
            }

            let mode = selectedMode;
            let onlyThisAthlete = null;

            if (mode === 'single') {
                onlyThisAthlete = currentAthleteId;
                if (!onlyThisAthlete) {
                    alert('❌ Could not detect athlete ID from URL');
                    return;
                }
            }

            const config = {
                mode,
                delay,
                apiEndpoint: 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/import-individual',
                athletesApiEndpoint: 'https://strava-club-workers.pedroqueiroz.workers.dev/api/parkrun/athletes-to-scrape',
                apiKey: apiKey,
                onlyThisAthlete: onlyThisAthlete,
                active: true
            };

            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));

            console.log('✅ Parkrun Batch Scraper activated!');
            console.log('Configuration:', config);
            console.log('\nThe scraper will now AUTO-RUN on each parkrun athlete page.');
            console.log('Click the button again to stop.');

            button.textContent = '🔄 Scraper Running...';
            button.classList.add('active');
            progressPanel.style.display = 'block';

            // Reset progress
            window.parkrunScraperProgress.update({
                current: 0,
                total: 0,
                success: 0,
                errors: 0,
                athleteName: 'Loading...'
            });
            document.getElementById('log-messages').innerHTML = '';

            button.onclick = function() {
                if (confirm('Stop the batch scraper?')) {
                    stopScraper();
                }
            };

            modal.remove();

            // Start scraping immediately
            runScraper();
        });

        // Close modal on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                console.log('❌ Scraper cancelled');
            }
        });
    }

    // Button click handler - start scraper
    button.onclick = function() {
        const apiKey = getApiKey();
        if (!apiKey) return;

        showConfigModal(apiKey);
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
        currentUrl.searchParams.set('autoNavigate', config.mode !== 'single' ? 'true' : 'false');
        if (config.onlyThisAthlete) {
            currentUrl.searchParams.set('onlyThisAthlete', config.onlyThisAthlete);
        }

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
