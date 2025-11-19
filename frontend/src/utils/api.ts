/**
 * Custom error for when the API returns HTML instead of JSON
 * (typically during deployments or maintenance)
 */
export class ApiMaintenanceError extends Error {
  constructor() {
    super('Website updating – please try again in one minute.');
    this.name = 'ApiMaintenanceError';
  }
}

/**
 * Fetch JSON from API with proper error handling for maintenance/deployment scenarios
 */
export async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  const contentType = response.headers.get('content-type') || '';

  // Check if response is HTML (deployment/error page) instead of JSON
  if (contentType.includes('text/html')) {
    throw new ApiMaintenanceError();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  // Try to parse JSON, but catch HTML responses that slipped through
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
      throw new ApiMaintenanceError();
    }
    throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
  }
}
