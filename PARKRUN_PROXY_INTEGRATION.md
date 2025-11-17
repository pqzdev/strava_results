# Parkrun Residential IP Proxy Integration

This document explains how to integrate the parkrun residential IP proxy with your Cloudflare Workers.

## Problem

AWS WAF blocks GitHub Actions and datacenter IPs from scraping parkrun.com.

## Solution

Route parkrun requests through your Home Assistant's residential IP using:
1. Python HTTP proxy on Home Assistant (port 8765)
2. Cloudflare Tunnel to expose the proxy
3. Workers fetch via proxy instead of directly

## Setup Steps

### 1. Deploy Proxy to Home Assistant

The proxy is already in your homeassistant repo at `/scripts/parkrun/`.

```bash
# Pull latest config
cd /config
git pull origin main

# Start the proxy
# Go to HA UI → Settings → Scripts → [Parkrun] Start Proxy Server
```

See [homeassistant/scripts/parkrun/README.md](https://github.com/kalvinoz/homeassistant/tree/main/scripts/parkrun) for details.

### 2. Configure Cloudflare Tunnel

Add a public hostname to your existing Cloudflare Tunnel:

- **Subdomain**: `parkrun-proxy`
- **Domain**: Your domain
- **Service**: `http://homeassistant11.local:8765`

See [homeassistant/scripts/parkrun/CLOUDFLARE_TUNNEL_SETUP.md](https://github.com/kalvinoz/homeassistant/tree/main/scripts/parkrun/CLOUDFLARE_TUNNEL_SETUP.md) for detailed instructions.

### 3. Add Environment Variable to Workers

```bash
cd workers
wrangler secret put PARKRUN_PROXY_URL
# Enter: https://parkrun-proxy.yourdomain.com
```

Or add via Cloudflare Dashboard:
- Go to **Workers & Pages → Your Worker → Settings → Variables**
- Add: `PARKRUN_PROXY_URL` = `https://parkrun-proxy.yourdomain.com`

### 4. Update Your Worker Code

Use the provided utility functions:

```typescript
import { fetchParkrunClubHistory } from './utils/parkrun-proxy';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      // Fetch via residential IP proxy
      const html = await fetchParkrunClubHistory(
        '19959', // Woodstock Runners club number
        env.PARKRUN_PROXY_URL
      );

      // Process HTML as before
      // ...

      return new Response('Success');
    } catch (error) {
      console.error('Parkrun fetch error:', error);
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }
};
```

## Available Utility Functions

### `fetchViaParkrunProxy(parkrunUrl, proxyBaseUrl, options?)`

Generic function to fetch any parkrun URL via proxy.

```typescript
const html = await fetchViaParkrunProxy(
  'https://www.parkrun.com.au/results/clubhistory/?clubNum=19959',
  env.PARKRUN_PROXY_URL,
  { timeout: 30000 } // Optional: override timeout (default 30s)
);
```

### `fetchParkrunClubHistory(clubNum, proxyBaseUrl)`

Fetch club history page.

```typescript
const html = await fetchParkrunClubHistory('19959', env.PARKRUN_PROXY_URL);
```

### `fetchParkrunAthleteHistory(athleteId, proxyBaseUrl)`

Fetch athlete history page.

```typescript
const html = await fetchParkrunAthleteHistory('123456', env.PARKRUN_PROXY_URL);
```

## Migration Example

**Before (direct fetch - blocked by WAF):**

```typescript
const response = await fetch(
  'https://www.parkrun.com.au/results/clubhistory/?clubNum=19959'
);
const html = await response.text();
```

**After (via residential IP proxy):**

```typescript
import { fetchParkrunClubHistory } from './utils/parkrun-proxy';

const html = await fetchParkrunClubHistory('19959', env.PARKRUN_PROXY_URL);
```

## Testing

### Test Proxy Locally

```bash
curl "http://homeassistant11.local:8765/fetch?url=https://www.parkrun.com.au"
```

### Test via Cloudflare Tunnel

```bash
curl "https://parkrun-proxy.yourdomain.com/fetch?url=https://www.parkrun.com.au"
```

### Test Worker Integration

```bash
cd workers
npm run dev  # Start local dev server
# Trigger your endpoint
curl http://localhost:8787/api/parkrun/import
```

### Monitor Logs

**Worker logs:**
```bash
wrangler tail
```

**Proxy logs (on HA):**
```bash
cat /config/logs/parkrun-proxy.log
```

## Troubleshooting

### Proxy not accessible
- Check proxy is running: HA → Scripts → [Parkrun] Check Proxy Status
- Verify Cloudflare Tunnel is configured correctly
- Test local access first before testing tunnel

### 403 Forbidden errors
- Ensure URL starts with `https://www.parkrun.com`
- Proxy only allows parkrun.com URLs for security

### Timeout errors
- Increase timeout in Worker code: `{ timeout: 60000 }`
- Check your residential internet connection
- Check proxy logs for upstream errors

### Worker can't reach proxy
- Verify `PARKRUN_PROXY_URL` environment variable is set
- Check Cloudflare Tunnel hostname is correct
- Test tunnel URL in browser first

## Architecture Diagram

```
GitHub Actions (blocked by WAF) ✗
          ↓
Cloudflare Workers
          ↓ HTTPS
Cloudflare Tunnel (parkrun-proxy.yourdomain.com)
          ↓ HTTP
Home Assistant Proxy (localhost:8765)
          ↓ Residential IP ✓
parkrun.com.au
```

## Performance Considerations

- **Caching**: Consider caching results in Workers KV to reduce proxy calls
- **Timeouts**: Residential internet may be slower - adjust timeouts accordingly
- **Rate limiting**: Be respectful of parkrun's servers

Example with caching:

```typescript
async function getCachedParkrunData(clubNum: string, env: Env): Promise<string> {
  const cacheKey = `parkrun:club:${clubNum}`;

  // Try cache first (if KV binding configured)
  if (env.KV) {
    const cached = await env.KV.get(cacheKey);
    if (cached) return cached;
  }

  // Fetch via proxy
  const html = await fetchParkrunClubHistory(clubNum, env.PARKRUN_PROXY_URL);

  // Cache for 1 hour
  if (env.KV) {
    await env.KV.put(cacheKey, html, { expirationTtl: 3600 });
  }

  return html;
}
```

## Files

- [workers/src/utils/parkrun-proxy.ts](workers/src/utils/parkrun-proxy.ts) - Utility functions
- [PARKRUN_PROXY_INTEGRATION.md](PARKRUN_PROXY_INTEGRATION.md) - This file
- See [homeassistant/scripts/parkrun/](https://github.com/kalvinoz/homeassistant/tree/main/scripts/parkrun) for proxy implementation

## Next Steps

1. ✅ Deploy proxy to Home Assistant
2. ✅ Configure Cloudflare Tunnel
3. ⏳ Add `PARKRUN_PROXY_URL` environment variable to Workers
4. ⏳ Update Worker code to use utility functions
5. ⏳ Test end-to-end integration
6. ⏳ Deploy updated Workers
