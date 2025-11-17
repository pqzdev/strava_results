/**
 * Test endpoint for parkrun proxy integration
 *
 * GET /api/parkrun/proxy-test
 *
 * Tests that the residential IP proxy is working correctly
 */

import { Env } from '../types';
import { fetchParkrunClubHistory } from '../utils/parkrun-proxy';

export async function testParkrunProxy(request: Request, env: Env): Promise<Response> {
  try {
    console.log('[Parkrun Proxy Test] Starting test...');

    // Check required environment variables
    if (!env.PARKRUN_PROXY_URL) {
      return new Response(
        JSON.stringify({
          error: 'Configuration error',
          message: 'PARKRUN_PROXY_URL not configured',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    if (!env.PARKRUN_PROXY_AUTH_TOKEN) {
      return new Response(
        JSON.stringify({
          error: 'Configuration error',
          message: 'PARKRUN_PROXY_AUTH_TOKEN not configured',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    console.log(`[Parkrun Proxy Test] Proxy URL: ${env.PARKRUN_PROXY_URL}`);
    console.log('[Parkrun Proxy Test] Auth token: [REDACTED]');

    // Fetch club history for Woodstock Runners (club 19959)
    const startTime = Date.now();
    const html = await fetchParkrunClubHistory(
      '19959',
      env.PARKRUN_PROXY_URL,
      env.PARKRUN_PROXY_AUTH_TOKEN
    );
    const duration = Date.now() - startTime;

    console.log(`[Parkrun Proxy Test] Success! Received ${html.length} bytes in ${duration}ms`);

    // Validate we got actual parkrun HTML
    const isParkrunHtml = html.includes('parkrun') || html.includes('Parkrun');
    const hasClubData = html.includes('19959') || html.includes('Woodstock');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Proxy test successful',
        proxyUrl: env.PARKRUN_PROXY_URL,
        stats: {
          htmlLength: html.length,
          duration: `${duration}ms`,
          isParkrunHtml,
          hasClubData,
        },
        sample: html.substring(0, 500), // First 500 chars for verification
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error: any) {
    console.error('[Parkrun Proxy Test] Error:', error);

    return new Response(
      JSON.stringify({
        error: 'Proxy test failed',
        message: error.message || 'Unknown error',
        stack: error.stack,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
