/**
 * Parkrun Proxy Utility
 *
 * Fetches parkrun pages via residential IP proxy to bypass AWS WAF blocking.
 * Uses Cloudflare Tunnel to route requests through Home Assistant.
 */

/**
 * Fetch a parkrun URL via the residential IP proxy
 *
 * @param parkrunUrl - The full parkrun.com URL to fetch
 * @param proxyBaseUrl - Your Cloudflare Tunnel proxy endpoint (from env)
 * @param options - Additional fetch options
 * @returns The HTML content from parkrun
 * @throws Error if fetch fails or proxy returns error
 */
export async function fetchViaParkrunProxy(
  parkrunUrl: string,
  proxyBaseUrl: string,
  options?: {
    timeout?: number; // Timeout in milliseconds (default: 30000)
  }
): Promise<string> {
  // Validate it's a parkrun URL
  if (!parkrunUrl.startsWith('https://www.parkrun.com')) {
    throw new Error('Only parkrun.com URLs are supported');
  }

  // Build proxy request URL
  const proxyUrl = `${proxyBaseUrl}/fetch?url=${encodeURIComponent(parkrunUrl)}`;

  console.log(`[Parkrun Proxy] Fetching via proxy: ${parkrunUrl}`);

  try {
    // Fetch with timeout
    const timeout = options?.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(proxyUrl, {
      headers: {
        'Accept': 'text/html',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');

      // Provide helpful error messages
      if (response.status === 403) {
        throw new Error('Proxy rejected URL (only parkrun.com URLs allowed)');
      }
      if (response.status === 500) {
        throw new Error(`Proxy server error: ${errorText}`);
      }

      throw new Error(`Proxy returned HTTP ${response.status}: ${errorText}`);
    }

    const html = await response.text();
    console.log(`[Parkrun Proxy] Success: ${html.length} bytes received`);

    return html;

  } catch (error: any) {
    // Handle timeout specifically
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${options?.timeout || 30000}ms`);
    }

    // Handle network errors
    if (error.message.includes('fetch failed')) {
      throw new Error(`Network error: Could not reach proxy at ${proxyBaseUrl}`);
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Fetch parkrun club history page
 *
 * @param clubNum - Parkrun club number (e.g., '19959' for Woodstock Runners)
 * @param proxyBaseUrl - Your Cloudflare Tunnel proxy endpoint
 * @returns HTML content of the club history page
 */
export async function fetchParkrunClubHistory(
  clubNum: string,
  proxyBaseUrl: string
): Promise<string> {
  const url = `https://www.parkrun.com.au/results/clubhistory/?clubNum=${clubNum}`;
  return fetchViaParkrunProxy(url, proxyBaseUrl);
}

/**
 * Fetch parkrun athlete history page
 *
 * @param athleteId - Parkrun athlete ID
 * @param proxyBaseUrl - Your Cloudflare Tunnel proxy endpoint
 * @returns HTML content of the athlete history page
 */
export async function fetchParkrunAthleteHistory(
  athleteId: string,
  proxyBaseUrl: string
): Promise<string> {
  const url = `https://www.parkrun.com.au/parkrunner/${athleteId}/all/`;
  return fetchViaParkrunProxy(url, proxyBaseUrl);
}
