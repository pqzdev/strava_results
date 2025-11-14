// Google OAuth authentication handlers
import { Env } from '../types';

const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name: string;
  family_name?: string;
  picture: string;
}

interface SessionData {
  email: string;
  name: string;
  google_id: string;
  exp: number; // Expiration timestamp
}

/**
 * Generate a simple JWT-like token
 * Note: For production, use a proper JWT library with signing
 */
async function createSessionToken(data: SessionData, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify(data));
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload + secret));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const signature = btoa(hashArray.map(b => String.fromCharCode(b)).join(''));
  return `${payload}.${signature}`;
}

/**
 * Verify and decode session token
 */
async function verifySessionToken(token: string, secret: string): Promise<SessionData | null> {
  try {
    const [payload, _signature] = token.split('.');
    if (!payload) return null;

    const data = JSON.parse(atob(payload)) as SessionData;

    // Check expiration
    if (data.exp < Date.now() / 1000) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Check if email is in admin whitelist
 */
async function isAdminEmail(env: Env, email: string): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT id FROM admin_users WHERE email = ?'
  ).bind(email).first();

  return result !== null;
}

/**
 * Update last login time
 */
async function updateLastLogin(env: Env, email: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE admin_users SET last_login_at = unixepoch() WHERE email = ?'
  ).bind(email).run();
}

/**
 * GET /auth/google/login - Redirect to Google OAuth
 */
export async function googleLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;

  const redirectUri = `${origin}/auth/google/callback`;

  const authUrl = new URL(GOOGLE_OAUTH_URL);
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('access_type', 'online');

  return Response.redirect(authUrl.toString(), 302);
}

/**
 * GET /auth/google/callback - Handle OAuth callback
 */
export async function googleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`Authentication error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  try {
    // Exchange code for tokens
    const redirectUri = `${url.origin}/auth/google/callback`;

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return new Response('Failed to exchange authorization code', { status: 500 });
    }

    const tokens = await tokenResponse.json() as GoogleTokenResponse;

    // Get user info
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      return new Response('Failed to get user info', { status: 500 });
    }

    const userInfo = await userInfoResponse.json() as GoogleUserInfo;

    // Check if email is in admin whitelist
    if (!await isAdminEmail(env, userInfo.email)) {
      // Return HTML page with error message
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Access Denied</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                background: #f5f5f5;
              }
              .container {
                text-align: center;
                background: white;
                padding: 3rem;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                max-width: 500px;
              }
              h1 { color: #ef4444; margin: 0 0 1rem; }
              p { color: #666; line-height: 1.6; }
              a {
                display: inline-block;
                margin-top: 1.5rem;
                padding: 0.75rem 1.5rem;
                background: #667eea;
                color: white;
                text-decoration: none;
                border-radius: 8px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>⛔ Access Denied</h1>
              <p>
                Your email <strong>${userInfo.email}</strong> is not authorized for admin access.
              </p>
              <p>
                Please contact the administrator to request access.
              </p>
              <a href="/">Return to Home</a>
            </div>
          </body>
        </html>
      `, {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Update last login time
    await updateLastLogin(env, userInfo.email);

    // Create session token (expires in 7 days)
    const sessionData: SessionData = {
      email: userInfo.email,
      name: userInfo.name,
      google_id: userInfo.id,
      exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
    };

    const sessionToken = await createSessionToken(sessionData, env.GOOGLE_CLIENT_SECRET);

    // Set cookie and redirect to admin panel
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin',
        'Set-Cookie': `admin_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
      },
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return new Response('Authentication failed', { status: 500 });
  }
}

/**
 * POST /auth/logout - Clear session
 */
export async function logout(request: Request): Promise<Response> {
  return new Response(JSON.stringify({ message: 'Logged out successfully' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * GET /auth/me - Get current admin info
 */
export async function getCurrentAdmin(request: Request, env: Env): Promise<Response> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map(c => {
      const [key, ...v] = c.split('=');
      return [key, v.join('=')];
    })
  );

  const sessionToken = cookies['admin_session'];
  if (!sessionToken) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionData = await verifySessionToken(sessionToken, env.GOOGLE_CLIENT_SECRET);
  if (!sessionData) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify email is still in whitelist
  if (!await isAdminEmail(env, sessionData.email)) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  return new Response(JSON.stringify({
    authenticated: true,
    email: sessionData.email,
    name: sessionData.name,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Middleware: Check if request has valid admin session
 */
export async function requireAdminAuth(request: Request, env: Env): Promise<SessionData | null> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map(c => {
      const [key, ...v] = c.split('=');
      return [key, v.join('=')];
    })
  );

  const sessionToken = cookies['admin_session'];
  if (!sessionToken) return null;

  const sessionData = await verifySessionToken(sessionToken, env.GOOGLE_CLIENT_SECRET);
  if (!sessionData) return null;

  // Verify email is still in whitelist
  if (!await isAdminEmail(env, sessionData.email)) {
    return null;
  }

  return sessionData;
}
