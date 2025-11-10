// Parkrun scraping utility functions

export interface ParkrunResult {
  athleteName: string;
  athleteId?: string; // parkrun athlete ID
  eventName: string;
  eventNumber: number;
  position: number;
  time: string; // Format: MM:SS or HH:MM:SS
  ageGrade?: string; // Format: XX.XX%
  ageCategory?: string; // e.g., "SM25-29"
  date: string; // ISO 8601 format
  clubName?: string;
}

export interface ParkrunClubResults {
  results: ParkrunResult[];
  totalResults: number;
  fetchedAt: number; // Unix timestamp
}

/**
 * Parse time string (MM:SS or HH:MM:SS) to seconds
 */
export function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Fetch consolidated club results from parkrun
 * @param clubNum - The parkrun club number (e.g., 19959 for Woodstock)
 * @param eventDate - Optional specific event date (YYYY-MM-DD format)
 */
export async function fetchParkrunClubResults(
  clubNum: number,
  eventDate?: string
): Promise<ParkrunClubResults> {
  const url = new URL('https://www.parkrun.com/results/consolidatedclub/');
  url.searchParams.set('clubNum', clubNum.toString());
  if (eventDate) {
    url.searchParams.set('eventdate', eventDate);
  }

  console.log(`Fetching parkrun results for club ${clubNum}${eventDate ? ` on ${eventDate}` : ''}`);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch parkrun data: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const results = parseParkrunClubHTML(html);

    return {
      results,
      totalResults: results.length,
      fetchedAt: Math.floor(Date.now() / 1000),
    };
  } catch (error) {
    console.error('Error fetching parkrun results:', error);
    throw error;
  }
}

/**
 * Parse parkrun consolidated club results HTML
 * This is a basic implementation - parkrun's HTML structure may vary
 */
function parseParkrunClubHTML(html: string): ParkrunResult[] {
  const results: ParkrunResult[] = [];

  // parkrun's consolidated club page typically has a table with results
  // The exact parsing logic depends on the HTML structure
  // This is a placeholder implementation that should be refined after examining the actual HTML

  // Look for table rows in the results table
  // Note: This is a simplified parser and may need adjustment based on actual HTML structure
  const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;

  let match;
  while ((match = tableRowRegex.exec(html)) !== null) {
    const rowHtml = match[1];
    const cells: string[] = [];

    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // Remove HTML tags and trim
      const cellContent = cellMatch[1]
        .replace(/<[^>]*>/g, '')
        .trim();
      cells.push(cellContent);
    }

    // Skip header rows or empty rows
    if (cells.length < 5 || cells[0].toLowerCase().includes('name')) {
      continue;
    }

    // Typical parkrun consolidated club format:
    // Date | Event | Position | Runner | Time | Age Grade | Age Category
    // The exact order may vary, so this is a best-guess implementation
    try {
      if (cells.length >= 5) {
        // Extract date (typically in format like "10/11/2025" or "2025-11-10")
        let dateStr = cells[0];
        // Convert to ISO format if needed
        if (dateStr.includes('/')) {
          const parts = dateStr.split('/');
          if (parts.length === 3) {
            // Assume DD/MM/YYYY
            dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }

        results.push({
          date: dateStr,
          eventName: cells[1] || 'Unknown',
          eventNumber: parseInt(cells[2]) || 0,
          position: parseInt(cells[3]) || 0,
          athleteName: cells[4] || 'Unknown',
          time: cells[5] || '00:00',
          ageGrade: cells[6] || undefined,
          ageCategory: cells[7] || undefined,
        });
      }
    } catch (error) {
      console.warn('Error parsing parkrun result row:', error);
      continue;
    }
  }

  return results;
}

/**
 * Fetch latest parkrun results (without specific date)
 */
export async function fetchLatestParkrunClubResults(
  clubNum: number
): Promise<ParkrunClubResults> {
  return fetchParkrunClubResults(clubNum);
}

/**
 * Get the last Saturday's date (parkrun typically happens on Saturdays)
 */
export function getLastSaturday(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysToSubtract = dayOfWeek === 6 ? 0 : (dayOfWeek + 1) % 7;
  const lastSaturday = new Date(today);
  lastSaturday.setDate(today.getDate() - daysToSubtract);
  return lastSaturday.toISOString().split('T')[0];
}

/**
 * Get all Saturdays in a date range (for bulk fetching)
 */
export function getSaturdaysInRange(startDate: string, endDate: string): string[] {
  const saturdays: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Find first Saturday
  const current = new Date(start);
  while (current.getDay() !== 6) {
    current.setDate(current.getDate() + 1);
  }

  // Collect all Saturdays
  while (current <= end) {
    saturdays.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 7);
  }

  return saturdays;
}
