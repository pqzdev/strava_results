#!/usr/bin/env node

/**
 * Automated Parkrun Scraper using Playwright
 *
 * This script launches a headless browser to scrape parkrun data automatically.
 * It supports IP rotation via proxies to avoid 403 blocks.
 *
 * Environment variables:
 * - PARKRUN_API_ENDPOINT: API endpoint to upload results
 * - PROXY_URL: Optional proxy URL (format: http://user:pass@host:port)
 * - START_DATE: Start date for scraping (YYYY-MM-DD)
 * - END_DATE: End date for scraping (YYYY-MM-DD)
 * - REPLACE_MODE: Whether to replace all existing data (true/false)
 */

const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  clubNum: 19959, // Woodstock Runners
  apiEndpoint: process.env.PARKRUN_API_ENDPOINT || '',
  proxyUrl: process.env.PROXY_URL || '',
  startDate: process.env.START_DATE || getDefaultStartDate(),
  endDate: process.env.END_DATE || getDefaultEndDate(),
  replaceMode: process.env.REPLACE_MODE === 'true',
  logFile: path.join(__dirname, 'parkrun-scraper.log'),
};

// User agents to rotate for more realistic behavior
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

/**
 * Get default start date (2 weeks ago)
 */
function getDefaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 14);
  return date.toISOString().split('T')[0];
}

/**
 * Get default end date (today)
 */
function getDefaultEndDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Random user agent for this session
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Log message to both console and file
 */
async function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(message);
  await fs.appendFile(CONFIG.logFile, logLine, 'utf8').catch(() => {});
}

/**
 * Main scraper function
 */
async function main() {
  await log('🏃 Starting Parkrun Automated Scraper');
  await log(`📅 Date range: ${CONFIG.startDate} to ${CONFIG.endDate}`);
  await log(`🔄 Replace mode: ${CONFIG.replaceMode}`);
  await log(`🌐 Proxy: ${CONFIG.proxyUrl ? 'Enabled' : 'Disabled'}`);
  await log('');

  // Validate API endpoint
  if (!CONFIG.apiEndpoint) {
    await log('❌ ERROR: PARKRUN_API_ENDPOINT environment variable not set');
    process.exit(1);
  }

  // Browser launch options
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  };

  // Add proxy if configured
  if (CONFIG.proxyUrl) {
    launchOptions.proxy = {
      server: CONFIG.proxyUrl,
    };
    await log(`🔒 Using proxy: ${CONFIG.proxyUrl.replace(/:[^:]*@/, ':****@')}`);
  }

  let browser;
  try {
    // Launch browser
    await log('🚀 Launching browser...');
    browser = await chromium.launch(launchOptions);

    // Create context with random user agent and realistic settings
    const userAgent = getRandomUserAgent();
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 1920, height: 1080 },
      locale: 'en-AU',
      timezoneId: 'Australia/Sydney',
      permissions: [],
      extraHTTPHeaders: {
        'Accept-Language': 'en-AU,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    // Create page
    const page = await context.newPage();

    // Load the scraper script
    const scraperPath = path.join(__dirname, '..', 'frontend', 'public', 'parkrun-smart-scraper.js');
    await log(`📜 Loading scraper from: ${scraperPath}`);
    const scraperScript = await fs.readFile(scraperPath, 'utf8');

    // Build parkrun URL with parameters
    const parkrunUrl = new URL('https://www.parkrun.com/results/consolidatedclub/');
    parkrunUrl.searchParams.set('clubNum', CONFIG.clubNum.toString());
    parkrunUrl.searchParams.set('startDate', CONFIG.startDate);
    parkrunUrl.searchParams.set('endDate', CONFIG.endDate);
    parkrunUrl.searchParams.set('apiEndpoint', CONFIG.apiEndpoint);
    parkrunUrl.searchParams.set('autoUpload', 'true');
    parkrunUrl.searchParams.set('replaceMode', CONFIG.replaceMode.toString());

    await log(`🌐 Navigating to: ${parkrunUrl.toString()}`);

    // Navigate to parkrun page
    const response = await page.goto(parkrunUrl.toString(), {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    if (!response || response.status() !== 200) {
      throw new Error(`Failed to load parkrun page: ${response?.status() || 'unknown'}`);
    }

    await log(`✅ Page loaded successfully (Status: ${response.status()})`);

    // Wait a bit for page to fully settle
    await page.waitForTimeout(2000);

    // Inject and execute the scraper script
    await log('💉 Injecting scraper script...');
    await page.evaluate(scraperScript);

    await log('⏳ Waiting for scraper to complete...');
    await log('   (This may take 3-5 minutes for ~100 dates)');
    await log('');

    // Track completion by monitoring console output
    let scraperCompleted = false;
    let completionResolver;
    const completionPromise = new Promise((resolve) => {
      completionResolver = resolve;
    });

    // Monitor console output from the page
    page.on('console', async (msg) => {
      const text = msg.text();

      // Check for completion signals
      if (
        text.includes('🎉 All done! All data uploaded successfully') ||
        text.includes('All data uploaded successfully in batches') ||
        text.includes('⚠️  No results found')
      ) {
        scraperCompleted = true;
        await log(`   ${text}`);
        completionResolver(true);
        return;
      }

      // Filter out noise and only log important messages
      if (
        text.includes('✅') ||
        text.includes('❌') ||
        text.includes('📤') ||
        text.includes('🎉') ||
        text.includes('ERROR') ||
        text.includes('Uploaded') ||
        text.includes('Summary')
      ) {
        await log(`   ${text}`);
      }
    });

    // Wait for scraper completion (detected via console logs)
    await Promise.race([
      completionPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 10 minutes')), 600000))
    ]);

    if (!scraperCompleted) {
      throw new Error('Scraper did not complete properly');
    }

    await log('');
    await log('🎉 Scraper completed successfully!');

  } catch (error) {
    await log('');
    await log(`❌ ERROR: ${error.message}`);
    await log(`Stack: ${error.stack}`);
    throw error;
  } finally {
    if (browser) {
      await log('🔚 Closing browser...');
      await browser.close();
    }
  }

  await log('✨ Done!');
}

// Run the scraper
main().catch(async (error) => {
  await log(`💥 Fatal error: ${error.message}`);
  process.exit(1);
});
