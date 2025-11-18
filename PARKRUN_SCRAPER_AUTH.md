# Parkrun Scraper Authentication

As of version 2.1 (batch scraper) and 1.1 (club scraper), the Tampermonkey scripts require API key authentication to protect the parkrun import endpoints.

## Why Authentication?

The parkrun import endpoints previously had no authentication, which meant:
- Anyone could read your parkrun athlete data
- Anyone could modify or delete parkrun results
- The database was exposed to unauthorized access

API key authentication ensures only authorized users can access these endpoints.

## Setup for Users

### First Time Setup

1. **Install the Tampermonkey script** (if not already installed)
   - For batch scraping: `parkrun-batch-tampermonkey.user.js`
   - For club scraping: `parkrun-club-tampermonkey.user.js`

2. **Get your API key from the admin**
   - Contact your system administrator to get the `PARKRUN_API_KEY`
   - This is a secure random string like: `a1b2c3d4e5f6...`

3. **First run - Enter API key**
   - When you first click the scraper button, you'll be prompted:
     ```
     Enter your Parkrun API Key:

     (This will be stored in your browser for future use)
     ```
   - Paste the API key provided by your admin
   - The key will be securely stored in your browser's localStorage

4. **Subsequent runs**
   - The script will automatically use the stored API key
   - No need to enter it again unless you clear browser data

### Resetting Your API Key

If you need to change your API key:

1. Open browser console (F12)
2. Run: `localStorage.removeItem('parkrun_scraper_api_key')`
3. Reload the page
4. The script will prompt for a new API key on next use

## Setup for Administrators

### Generate a Secure API Key

```bash
# Option 1: Using OpenSSL (recommended)
openssl rand -hex 32

# Option 2: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Option 3: Online generator (use a trusted source)
# Visit: https://www.random.org/strings/?num=1&len=64&digits=on&loweralpha=on&unique=on&format=html&rnd=new
```

### Set the API Key in Production

```bash
cd workers

# Set the Parkrun API key
wrangler secret put PARKRUN_API_KEY
# When prompted, paste the generated API key
```

### Set the API Key for Local Development

Add to `workers/.dev.vars`:

```env
PARKRUN_API_KEY=your_generated_api_key_here
```

**Important**: Never commit the actual API key to git!

### Distribute the API Key to Users

Options for sharing the API key securely:
1. **Password manager** - Share via team password manager
2. **Secure messaging** - Send via encrypted messaging app
3. **In-person** - Share during team meetings
4. **Admin panel** (future enhancement) - Display in admin UI for authenticated users

### Rotating the API Key

If the API key is compromised:

1. **Generate a new key**:
   ```bash
   openssl rand -hex 32
   ```

2. **Update production**:
   ```bash
   cd workers
   wrangler secret put PARKRUN_API_KEY
   # Enter the new key
   ```

3. **Notify all users**:
   - Users need to clear their stored key: `localStorage.removeItem('parkrun_scraper_api_key')`
   - Or simply enter the new key when prompted after failed authentication

4. **Update development** (if needed):
   - Update `workers/.dev.vars`

## Security Best Practices

### For Users
- ✅ Keep your API key private - don't share it publicly
- ✅ Don't paste it in public forums or screenshots
- ✅ Clear localStorage if using a shared computer
- ✅ Report lost or compromised keys to your admin

### For Administrators
- ✅ Use a strong, randomly generated key (32+ characters)
- ✅ Rotate keys periodically (e.g., every 6 months)
- ✅ Use different keys for development and production
- ✅ Never commit API keys to git
- ✅ Monitor API usage logs for suspicious activity
- ✅ Consider implementing per-user API keys in the future

## Troubleshooting

### "Unauthorized" Error

If you see a 401 Unauthorized error:

1. **Check your API key is entered correctly**
   - Clear localStorage and re-enter the key
   - Make sure there are no extra spaces

2. **Verify the key with your admin**
   - The admin may have rotated the key
   - Get the current valid key

3. **Check browser console for errors**
   - Open DevTools (F12) → Console tab
   - Look for authentication-related errors

### API Key Not Saving

If the script keeps asking for your API key:

1. **Check browser settings**
   - Ensure localStorage is enabled
   - Check if browser is in incognito/private mode (localStorage doesn't persist)

2. **Check for browser extensions**
   - Some privacy extensions block localStorage
   - Temporarily disable and test

3. **Try a different browser**
   - Test if the issue is browser-specific

### "Failed to Load Scraper Script"

This error is unrelated to authentication. Possible causes:
- Network connectivity issues
- Cloudflare Pages deployment is down
- Incorrect SCRIPT_URL in the Tampermonkey script

## API Endpoints Protected

The following endpoints now require the `X-API-Key` header:

1. **POST** `/api/parkrun/import`
   - Used by club scraper to import club results

2. **POST** `/api/parkrun/import-individual`
   - Used by batch scraper to import individual athlete histories

3. **GET** `/api/parkrun/athletes-to-scrape`
   - Used by batch scraper to get list of athletes to scrape

All other endpoints remain publicly accessible (read-only operations).

## Technical Details

### How It Works

1. **Browser Storage**: API key is stored in `localStorage` with key `parkrun_scraper_api_key`
2. **Request Header**: Scripts include `X-API-Key: <your-key>` header in all API requests
3. **Server Validation**: Cloudflare Workers middleware verifies the key matches `PARKRUN_API_KEY` secret
4. **Response**: Returns 401 Unauthorized if key is missing or invalid

### For Developers

The authentication middleware is implemented in:
- `workers/src/middleware/auth.ts` - Authentication functions
- `workers/src/index.ts` - Applied to parkrun endpoints

To add authentication to other endpoints:
```typescript
import { requireApiKey } from './middleware/auth';

// In your route handler
if (path === '/api/your-endpoint' && request.method === 'POST') {
  const authError = await requireApiKey(request, env);
  if (authError) return authError;
  return yourHandler(request, env);
}
```

---

**Questions?** Contact your system administrator or open an issue on GitHub.
