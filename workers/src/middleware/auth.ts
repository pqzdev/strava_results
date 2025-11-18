// Authentication middleware for API endpoints
import { Env } from '../types';

/**
 * Verify API key from request header
 * Checks X-API-Key header against PARKRUN_API_KEY secret
 */
export async function verifyApiKey(request: Request, env: Env): Promise<boolean> {
  const apiKey = request.headers.get('X-API-Key');

  if (!apiKey) {
    return false;
  }

  // Check if PARKRUN_API_KEY is configured
  if (!env.PARKRUN_API_KEY) {
    console.error('PARKRUN_API_KEY not configured in environment');
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return apiKey === env.PARKRUN_API_KEY;
}

/**
 * Middleware: Require valid API key for parkrun endpoints
 * Returns 401 Unauthorized response if API key is invalid
 */
export async function requireApiKey(request: Request, env: Env): Promise<Response | null> {
  const isValid = await verifyApiKey(request, env);

  if (!isValid) {
    return new Response(
      JSON.stringify({
        error: 'Unauthorized',
        message: 'Valid API key required. Include X-API-Key header with your request.',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'WWW-Authenticate': 'API-Key',
        },
      }
    );
  }

  return null; // Authentication successful
}
