#!/usr/bin/env node

/**
 * Parkrun Scraper for Home Assistant
 *
 * Runs Playwright automation to scrape parkrun consolidated club results
 * and upload to the Strava Results API.
 *
 * Usage:
 *   node parkrun-homeassistant.js [config-file]
 *
 * Config file: JSON file with configuration (defaults to ./parkrun-config.json)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = process.argv[2] || path.join(__dirname, 'parkrun-config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`✓ Loaded configuration from ${configPath}`);
} catch (error) {
  console.error(`❌ Failed to load configuration from ${configPath}`);
  console.error(`Error: ${error.message}`);
  console.error('\nPlease create parkrun-config.json with the following structure:');
  console.error(JSON.stringify({
    apiEndpoint: 'https://your-api.com/api/parkrun/import',
    clubNumber: '19959',
    startDate: '2024-01-01',
    endDate: '2025-11-17',
    replaceMode: false,
    headless: true,
    timeout: 600000,
    executablePath: '/usr/bin/chromium-browser'
  }, null, 2));
  process.exit(1);
}

// Validate required config
const required = ['apiEndpoint', 'clubNumber'];
for (const key of required) {
  if (!config[key]) {
    console.error(`❌ Missing required configuration: ${key}`);
    process.exit(1);
  }
}

// Set defaults
config.headless = config.headless !== false; // default true
config.timeout = config.timeout || 600000; // 10 minutes
config.replaceMode = config.replaceMode || false;
config.executablePath = config.executablePath || '/usr/bin/chromium-browser'; // Alpine Linux default

// Calculate date range if not specified
if (!config.startDate) {
  // Default: last 2 weeks
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  config.startDate = twoWeeksAgo.toISOString().split('T')[0];
}

if (!config.endDate) {
  // Default: today
  config.endDate = new Date().toISOString().split('T')[0];
}

console.log('\n📋 Configuration:');
console.log(`   API Endpoint: ${config.apiEndpoint}`);
console.log(`   Club Number: ${config.clubNumber}`);
console.log(`   Date Range: ${config.startDate} to ${config.endDate}`);
console.log(`   Replace Mode: ${config.replaceMode}`);
console.log(`   Headless: ${config.headless}`);
console.log(`   Timeout: ${config.timeout}ms`);
console.log(`   Executable: ${config.executablePath}\n`);

async function main() {
  const startTime = Date.now();
  let browser;

  try {
    console.log('🚀 Starting Parkrun scraper...\n');

    // Launch browser
    console.log('📦 Launching Chromium browser...');
    browser = await chromium.launch({
      headless: config.headless,
      executablePath: config.executablePath, // Use system Chromium for Alpine Linux
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-AU',
      timezoneId: 'Australia/Sydney',
    });

    const page = await context.newPage();

    // Set up console logging
    const consoleMessages = [];
    let scraperCompleted = false;
    let scraperFailed = false;

    page.on('console', msg => {
      const text = msg.text();
      console.log(`[SCRAPER] ${text}`);
      consoleMessages.push(text);

      // Check for completion signals
      if (
        text.includes('🎉 All done! All data uploaded successfully') ||
        text.includes('All data uploaded successfully in batches') ||
        text.includes('⚠️  No results found')
      ) {
        scraperCompleted = true;
      }

      // Check for failure signals
      if (text.includes('❌') || text.includes('Error:')) {
        scraperFailed = true;
      }
    });

    page.on('pageerror', error => {
      console.log(`[PAGE ERROR] ${error.message}`);
      scraperFailed = true;
    });

    // Build parkrun URL with parameters
    const url = new URL(`https://www.parkrun.com/results/consolidatedclub/`);
    url.searchParams.set('clubNum', config.clubNumber);
    url.searchParams.set('startDate', config.startDate);
    url.searchParams.set('endDate', config.endDate);
    url.searchParams.set('apiEndpoint', config.apiEndpoint);
    url.searchParams.set('autoUpload', 'true');
    if (config.replaceMode) {
      url.searchParams.set('replaceMode', 'true');
    }

    console.log(`📡 Navigating to: ${url.toString()}\n`);

    // Navigate to parkrun
    const response = await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log(`✓ Page loaded (Status: ${response.status()})\n`);

    if (response.status() !== 200 && response.status() !== 202) {
      throw new Error(`Failed to load parkrun page: ${response.status()}`);
    }

    // Load the scraper script
    console.log('📜 Loading scraper script...');
    const scraperScript = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'public', 'parkrun-smart-scraper.js'),
      'utf8'
    );

    // Wait for page to settle
    console.log('⏳ Waiting for page to be fully ready...');
    await page.waitForTimeout(3000);

    // Inject and execute scraper
    console.log('💉 Injecting scraper into page...\n');
    await page.evaluate(scraperScript);

    console.log('⏳ Waiting for scraper to complete (timeout: ' + (config.timeout / 1000) + 's)...');
    console.log('   (This may take 3-5 minutes for ~100 dates)\n');

    // Wait for completion signal
    const startWait = Date.now();
    while (!scraperCompleted && !scraperFailed && (Date.now() - startWait < config.timeout)) {
      await page.waitForTimeout(1000);
    }

    if (scraperFailed) {
      throw new Error('Scraper encountered errors during execution');
    }

    if (!scraperCompleted) {
      throw new Error('Scraper timed out');
    }

    console.log('\n✅ Scraper completed successfully!\n');

    // Get results summary
    const summary = await page.evaluate(() => ({
      totalResults: window.scraperResults?.length || 0,
      uploaded: window.scraperUploaded || false
    }));

    console.log('📊 Results Summary:');
    console.log(`   Total Results: ${summary.totalResults}`);
    console.log(`   Uploaded: ${summary.uploaded ? 'Yes' : 'No'}`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Total duration: ${duration}s`);

    if (!summary.uploaded) {
      console.warn('\n⚠️  Warning: Data was not uploaded. Check scraper logs above.');
      process.exit(1);
    }

    console.log('\n🎉 All done!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
