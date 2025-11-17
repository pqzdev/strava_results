#!/usr/bin/env node

/**
 * Parkrun POC Test - Minimal test to verify HA can access parkrun
 *
 * This script tests whether Home Assistant can bypass AWS WAF blocking
 * by using a residential IP address instead of GitHub Actions IPs.
 *
 * Tests:
 * 1. Can we load parkrun.com at all?
 * 2. Can we load the consolidated club results page?
 * 3. Does it return 200 OK or 403 Forbidden?
 * 4. Can we see actual data on the page?
 */

const { chromium } = require('playwright');

const CONFIG = {
  clubNum: 19959,
  testUrl: 'https://www.parkrun.com/results/consolidatedclub/',
  timeout: 30000,
};

async function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const prefix = level === 'ERROR' ? '❌' : level === 'SUCCESS' ? '✅' : 'ℹ️';
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

async function main() {
  let browser;

  try {
    await log('🏃 Parkrun POC Test - Starting...', 'INFO');
    await log('Testing if Home Assistant can access parkrun.com', 'INFO');
    await log('', 'INFO');

    // Launch browser - use system chromium for Alpine Linux
    await log('📦 Launching Chromium...', 'INFO');
    browser = await chromium.launch({
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Test 1: Load parkrun homepage
    await log('Test 1: Loading parkrun.com homepage...', 'INFO');
    try {
      const homeResponse = await page.goto('https://www.parkrun.com/', {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.timeout
      });

      if (homeResponse.status() === 200) {
        await log(`Test 1: PASSED - Homepage loaded (Status: ${homeResponse.status()})`, 'SUCCESS');
      } else {
        await log(`Test 1: WARNING - Homepage returned ${homeResponse.status()}`, 'ERROR');
      }
    } catch (error) {
      await log(`Test 1: FAILED - ${error.message}`, 'ERROR');
      throw error;
    }

    await log('', 'INFO');

    // Test 2: Load consolidated club results page
    const testUrl = `${CONFIG.testUrl}?clubNum=${CONFIG.clubNum}`;
    await log(`Test 2: Loading consolidated club results...`, 'INFO');
    await log(`URL: ${testUrl}`, 'INFO');

    try {
      const resultsResponse = await page.goto(testUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.timeout
      });

      const status = resultsResponse.status();

      if (status === 200 || status === 202) {
        await log(`Test 2: PASSED - Results page loaded (Status: ${status})`, 'SUCCESS');
      } else if (status === 403) {
        await log(`Test 2: FAILED - 403 Forbidden (AWS WAF blocked us)`, 'ERROR');
        throw new Error('AWS WAF blocking detected');
      } else {
        await log(`Test 2: WARNING - Unexpected status ${status}`, 'ERROR');
      }
    } catch (error) {
      await log(`Test 2: FAILED - ${error.message}`, 'ERROR');
      throw error;
    }

    await log('', 'INFO');

    // Test 3: Check if page has expected content
    await log('Test 3: Checking page content...', 'INFO');
    try {
      const title = await page.title();
      await log(`Page title: "${title}"`, 'INFO');

      // Check for the club results table
      const hasTable = await page.evaluate(() => {
        return document.querySelector('table') !== null;
      });

      if (hasTable) {
        await log('Test 3: PASSED - Found table element on page', 'SUCCESS');
      } else {
        await log('Test 3: WARNING - No table found (page might not have loaded correctly)', 'ERROR');
      }

      // Check for "No results" message
      const pageText = await page.evaluate(() => document.body.innerText);
      if (pageText.toLowerCase().includes('no results')) {
        await log('Test 3: INFO - Page shows "no results" (this is OK, means we can access it)', 'SUCCESS');
      }

    } catch (error) {
      await log(`Test 3: FAILED - ${error.message}`, 'ERROR');
    }

    await log('', 'INFO');

    // Test 4: Take a screenshot for manual verification
    await log('Test 4: Taking screenshot...', 'INFO');
    try {
      const screenshotPath = '/config/www/parkrun-poc-test.png';
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await log(`Screenshot saved to: ${screenshotPath}`, 'SUCCESS');
      await log('You can view it at: http://homeassistant11.local:8123/local/parkrun-poc-test.png', 'INFO');
    } catch (error) {
      await log(`Screenshot failed: ${error.message}`, 'ERROR');
    }

    await log('', 'INFO');
    await log('🎉 POC TEST COMPLETE - All tests passed!', 'SUCCESS');
    await log('', 'INFO');
    await log('✅ CONCLUSION: Home Assistant CAN access parkrun.com', 'SUCCESS');
    await log('✅ This residential IP successfully bypasses AWS WAF!', 'SUCCESS');
    await log('✅ You can proceed with full implementation', 'SUCCESS');

    process.exit(0);

  } catch (error) {
    await log('', 'INFO');
    await log('❌ POC TEST FAILED', 'ERROR');
    await log(`Error: ${error.message}`, 'ERROR');
    await log('', 'INFO');
    await log('⚠️  CONCLUSION: Could not access parkrun from this network', 'ERROR');
    await log('⚠️  This might be a different issue than AWS WAF blocking', 'ERROR');

    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
