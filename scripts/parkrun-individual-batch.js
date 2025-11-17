#!/usr/bin/env node

/**
 * Parkrun Individual Athlete Batch Scraper
 *
 * Scrapes individual parkrun history for athletes from their /all/ pages.
 * Can scrape:
 * - Only new athletes (not yet scraped)
 * - All athletes (full refresh)
 *
 * Usage:
 *   node parkrun-individual-batch.js [config-file] [mode]
 *
 * Config file: JSON file with configuration (defaults to ./parkrun-individual-config.json)
 * Mode: 'new' (only unscraped athletes) or 'all' (refresh everyone) - defaults to 'new'
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const configPath = process.argv[2] || path.join(__dirname, 'parkrun-individual-config.json');
const mode = process.argv[3] || 'new'; // 'new' or 'all'

if (!['new', 'all'].includes(mode)) {
  console.error(`❌ Invalid mode: ${mode}`);
  console.error('   Mode must be "new" (only unscraped) or "all" (full refresh)');
  process.exit(1);
}

// Load configuration
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log(`✓ Loaded configuration from ${configPath}`);
} catch (error) {
  console.error(`❌ Failed to load configuration from ${configPath}`);
  console.error(`Error: ${error.message}`);
  console.error('\nPlease create parkrun-individual-config.json with the following structure:');
  console.error(JSON.stringify({
    apiEndpoint: 'https://your-api.com/api/parkrun/import-individual',
    dbPath: './path/to/database.sqlite',
    headless: true,
    delayBetweenAthletes: 3000,
    timeout: 300000
  }, null, 2));
  process.exit(1);
}

// Validate required config
const required = ['apiEndpoint', 'dbPath'];
for (const key of required) {
  if (!config[key]) {
    console.error(`❌ Missing required configuration: ${key}`);
    process.exit(1);
  }
}

// Set defaults
config.headless = config.headless !== false;
config.timeout = config.timeout || 300000; // 5 minutes per athlete
config.delayBetweenAthletes = config.delayBetweenAthletes || 3000; // 3 seconds between athletes

console.log('\n📋 Configuration:');
console.log(`   API Endpoint: ${config.apiEndpoint}`);
console.log(`   Database: ${config.dbPath}`);
console.log(`   Mode: ${mode === 'new' ? 'New athletes only' : 'Full refresh (all athletes)'}`);
console.log(`   Headless: ${config.headless}`);
console.log(`   Delay between athletes: ${config.delayBetweenAthletes}ms`);
console.log(`   Timeout per athlete: ${config.timeout}ms\n`);

/**
 * Get list of athletes to scrape from database
 */
async function getAthletesToScrape(dbPath, mode) {
  // This would normally use a database library, but for simplicity
  // we'll expect the caller to provide athlete IDs via API or file

  console.log('📊 Fetching athletes to scrape...');

  // For now, we'll fetch the list from an API endpoint
  // In production, you might query the database directly
  const apiUrl = config.apiEndpoint.replace('/import-individual', '/athletes-to-scrape');
  const url = new URL(apiUrl);
  url.searchParams.set('mode', mode);

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    return data.athletes || [];

  } catch (error) {
    console.error(`❌ Failed to fetch athletes from API: ${error.message}`);
    console.log('   Falling back to manual athlete list...\n');

    // Fallback: read from a file if API doesn't exist yet
    const athletesFile = path.join(__dirname, 'athletes-to-scrape.json');
    if (fs.existsSync(athletesFile)) {
      const athletes = JSON.parse(fs.readFileSync(athletesFile, 'utf8'));
      return athletes;
    }

    console.error('❌ No athletes list found');
    console.log('   Create athletes-to-scrape.json with format:');
    console.log('   [{"parkrun_athlete_id": "7796495", "athlete_name": "Pedro QUEIROZ"}, ...]');
    process.exit(1);
  }
}

/**
 * Scrape a single athlete's parkrun history
 */
async function scrapeAthlete(browser, athlete, scraperScript) {
  const { parkrun_athlete_id, athlete_name } = athlete;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🏃 Scraping: ${athlete_name} (${parkrun_athlete_id})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Set up console logging
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React DevTools')) {
      console.log(`  [SCRAPER] ${text}`);
    }
  });

  try {
    // Build URL for athlete's /all/ page
    // Note: parkrun domain varies by country (.com.au, .com, .co.uk, etc.)
    // For now, we'll assume .com.au, but this could be made configurable
    const url = new URL(`https://www.parkrun.com.au/parkrunner/${parkrun_athlete_id}/all/`);
    url.searchParams.set('apiEndpoint', config.apiEndpoint);
    url.searchParams.set('autoUpload', 'true');

    console.log(`  🌐 Navigating to: ${url.toString()}`);

    // Navigate to athlete's page
    const response = await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    if (!response) {
      throw new Error('Failed to load page');
    }

    console.log(`  ✓ Page loaded (Status: ${response.status()})`);

    if (response.status() === 404) {
      console.error(`  ❌ Athlete page not found (404)`);
      console.log(`     URL: ${url.toString()}`);
      return { success: false, error: '404 Not Found' };
    }

    if (response.status() !== 200) {
      throw new Error(`Page returned status ${response.status()}`);
    }

    // Inject and execute scraper script
    console.log(`  💉 Injecting scraper script...\n`);
    await page.evaluate(scraperScript);

    // Wait for completion signal (with timeout)
    console.log(`  ⏳ Waiting for scraper to complete...`);

    await page.waitForFunction(
      () => window.scraperCompleted === true,
      { timeout: config.timeout }
    );

    console.log(`  ✅ Scraper completed!`);

    // Get results summary
    const summary = await page.evaluate(() => ({
      totalResults: window.scraperResults?.length || 0,
      uploaded: window.scraperUploaded || false
    }));

    console.log(`  📊 Results: ${summary.totalResults}`);
    console.log(`  📤 Uploaded: ${summary.uploaded ? 'Yes' : 'No'}`);

    await context.close();

    return {
      success: true,
      totalResults: summary.totalResults,
      uploaded: summary.uploaded
    };

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    await context.close();

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  let browser;

  try {
    console.log('🚀 Starting individual athlete scraper...\n');

    // Get athletes to scrape
    const athletes = await getAthletesToScrape(config.dbPath, mode);

    if (athletes.length === 0) {
      console.log('✓ No athletes to scrape');
      return;
    }

    console.log(`✓ Found ${athletes.length} athletes to scrape\n`);

    // Load scraper script
    console.log('📜 Loading individual scraper script...');
    const scraperScript = fs.readFileSync(
      path.join(__dirname, '..', 'frontend', 'public', 'parkrun-individual-scraper.js'),
      'utf8'
    );
    console.log('✓ Scraper script loaded\n');

    // Launch browser
    console.log('📦 Launching Chromium browser...');
    browser = await chromium.launch({
      headless: config.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('✓ Browser launched\n');

    // Scrape each athlete
    const results = {
      total: athletes.length,
      successful: 0,
      failed: 0,
      totalResultsScraped: 0
    };

    for (let i = 0; i < athletes.length; i++) {
      const athlete = athletes[i];

      console.log(`\n[${i + 1}/${athletes.length}] ${Math.round((i / athletes.length) * 100)}%`);

      const result = await scrapeAthlete(browser, athlete, scraperScript);

      if (result.success) {
        results.successful++;
        results.totalResultsScraped += result.totalResults || 0;
      } else {
        results.failed++;
      }

      // Delay between athletes (except on last one)
      if (i < athletes.length - 1) {
        console.log(`\n  ⏱️  Waiting ${config.delayBetweenAthletes}ms before next athlete...`);
        await new Promise(resolve => setTimeout(resolve, config.delayBetweenAthletes));
      }
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ BATCH SCRAPING COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`📊 Statistics:`);
    console.log(`   Total athletes: ${results.total}`);
    console.log(`   Successful: ${results.successful}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Total parkrun results scraped: ${results.totalResultsScraped}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Average per athlete: ${(duration / results.total).toFixed(1)}s\n`);

    console.log('🎉 All done!\n');

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
