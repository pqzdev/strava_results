// AI-powered event name analysis and grouping
import { Env, Race } from '../types';

interface RaceGroup {
  races: Race[];
  avgDate: Date;
  avgDistance: number;
}

/**
 * Group races by date and distance proximity
 * Races within ±1 day and ±5% distance are considered the same event
 */
export function groupRacesByEvent(races: Race[]): RaceGroup[] {
  const groups: RaceGroup[] = [];
  const processed = new Set<number>();

  // Sort races by date
  const sortedRaces = [...races].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const race of sortedRaces) {
    if (processed.has(race.id)) continue;

    const raceDate = new Date(race.date);
    const group: Race[] = [race];
    processed.add(race.id);

    // Use manual_distance if available, otherwise use distance
    const raceDistance = race.manual_distance || race.distance;

    // Find similar races
    for (const otherRace of sortedRaces) {
      if (processed.has(otherRace.id)) continue;

      const otherDate = new Date(otherRace.date);
      const daysDiff = Math.abs((otherDate.getTime() - raceDate.getTime()) / (1000 * 60 * 60 * 24));

      // Use manual_distance if available, otherwise use distance
      const otherDistance = otherRace.manual_distance || otherRace.distance;
      const distanceDiff = Math.abs(otherDistance - raceDistance) / raceDistance;

      // Group if within ±1 day and ±5% distance
      if (daysDiff <= 1 && distanceDiff <= 0.05) {
        group.push(otherRace);
        processed.add(otherRace.id);
      }
    }

    // Only create group if there are multiple races (or single race with race-like name)
    if (group.length >= 2 || isLikelyRaceName(race.name)) {
      const avgDistance = group.reduce((sum, r) => sum + (r.manual_distance || r.distance), 0) / group.length;
      const avgDate = new Date(
        group.reduce((sum, r) => sum + new Date(r.date).getTime(), 0) / group.length
      );

      groups.push({
        races: group,
        avgDate,
        avgDistance,
      });
    }
  }

  return groups;
}

/**
 * Check if activity name suggests it's a race
 */
function isLikelyRaceName(name: string): boolean {
  const racyKeywords = [
    'marathon', 'half', 'parkrun', '10k', '5k', 'race',
    'fun run', 'city2surf', 'blackmores', 'sydney running festival',
    'championship', 'relay', 'ultra', 'trail run'
  ];

  const lowerName = name.toLowerCase();
  return racyKeywords.some(keyword => lowerName.includes(keyword));
}

/**
 * Use AI to extract canonical event name (without year)
 */
export async function extractEventName(
  group: RaceGroup,
  env: Env
): Promise<{ eventName: string; confidence: number }> {
  const raceNames = group.races.map(r => r.name).join('\n- ');
  const distanceKm = (group.avgDistance / 1000).toFixed(1);
  const dateStr = group.avgDate.toISOString().split('T')[0];

  const prompt = `You are analyzing running race data from Strava. Given these activity names from different athletes who ran the same race event:

- ${raceNames}

Race details:
- Average distance: ${distanceKm} km
- Date: ${dateStr}
- Number of participants: ${group.races.length}

Extract the canonical event name WITHOUT the year. For example:
- "Sydney Marathon 2024" → "Sydney Marathon"
- "2024 Blackmores Sydney Running Festival - Half Marathon" → "Blackmores Sydney Running Festival - Half Marathon"
- "City2Surf 14km 2024" → "City2Surf"

Return ONLY the event name, nothing else. Keep it concise and remove year references.`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that extracts canonical race event names from activity data. Always remove year references from event names.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 50,
      temperature: 0.3, // Lower temperature for more consistent results
    });

    // Extract the event name from response
    const eventName = (response as any).response?.trim() || '';

    // Calculate confidence based on name consistency
    const uniqueNames = new Set(group.races.map(r => r.name.toLowerCase()));
    const confidence = 1 - (uniqueNames.size / group.races.length);

    return {
      eventName,
      confidence: Math.max(0.3, Math.min(1, confidence + 0.2)) // Boost confidence slightly, cap between 0.3-1
    };
  } catch (error) {
    console.error('AI event name extraction failed:', error);

    // Fallback: use most common name and remove year patterns
    const nameCounts = new Map<string, number>();
    group.races.forEach(r => {
      const count = nameCounts.get(r.name) || 0;
      nameCounts.set(r.name, count + 1);
    });

    const mostCommon = Array.from(nameCounts.entries())
      .sort((a, b) => b[1] - a[1])[0][0];

    const eventName = mostCommon
      .replace(/\b20\d{2}\b/g, '') // Remove years like 2024
      .replace(/\s+/g, ' ')        // Clean up extra spaces
      .trim();

    return {
      eventName,
      confidence: 0.3 // Low confidence for fallback
    };
  }
}

/**
 * Analyze all ungrouped races and create event suggestions
 */
export async function analyzeEvents(env: Env): Promise<void> {
  try {
    console.log('Starting event analysis...');

    // Get all races without event names
    const result = await env.DB.prepare(`
      SELECT id, name, distance, manual_distance, date
      FROM races
      WHERE event_name IS NULL
      ORDER BY date DESC
      LIMIT 1000
    `).all();

    const ungroupedRaces = result.results as unknown as Race[];

    if (ungroupedRaces.length === 0) {
      console.log('No ungrouped races to analyze');
      return;
    }

    console.log(`Found ${ungroupedRaces.length} ungrouped races`);

    // Group races by similarity
    const groups = groupRacesByEvent(ungroupedRaces);
    console.log(`Created ${groups.length} race groups`);

    // Analyze each group (limit to 50 groups to stay within AI limits)
    for (const group of groups.slice(0, 50)) {
      const { eventName, confidence } = await extractEventName(group, env);

      if (!eventName) {
        console.log(`Skipping group with ${group.races.length} races - no event name extracted`);
        continue;
      }

      // Store suggestion
      await env.DB.prepare(`
        INSERT INTO event_suggestions
        (race_ids, suggested_event_name, avg_date, avg_distance, race_count, confidence, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).bind(
        JSON.stringify(group.races.map(r => r.id)),
        eventName,
        group.avgDate.toISOString().split('T')[0],
        Math.round(group.avgDistance),
        group.races.length,
        confidence
      ).run();

      console.log(`Created suggestion: "${eventName}" for ${group.races.length} races (confidence: ${confidence.toFixed(2)})`);

      // Auto-approve high confidence suggestions (>=0.8) with 3+ races
      if (confidence >= 0.8 && group.races.length >= 3) {
        const raceIds = group.races.map(r => r.id);
        await env.DB.prepare(`
          UPDATE races
          SET event_name = ?
          WHERE id IN (${raceIds.map(() => '?').join(',')})
        `).bind(eventName, ...raceIds).run();

        await env.DB.prepare(`
          UPDATE event_suggestions
          SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP
          WHERE suggested_event_name = ? AND avg_date = ?
        `).bind(eventName, group.avgDate.toISOString().split('T')[0]).run();

        console.log(`Auto-approved high confidence suggestion: "${eventName}"`);
      }
    }

    console.log('Event analysis complete');
  } catch (error) {
    console.error('Event analysis failed:', error);
    throw error;
  }
}
