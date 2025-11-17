// API Commands Configuration
// This file defines all available API commands for the Admin API Control Panel
// To add a new command, add an entry to the API_COMMANDS array below

export interface ApiParameter {
  name: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'textarea' | 'json';
  label: string;
  placeholder?: string;
  required?: boolean;
  default?: any;
  options?: Array<{ value: string | number; label: string }>;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ApiCommand {
  id: string;
  category: string;
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  parameters?: ApiParameter[];
  requiresAuth?: boolean;
  confirmMessage?: string;
  successMessage?: string;
  dangerous?: boolean;
}

export const API_COMMANDS: ApiCommand[] = [
  // ========================================
  // QUEUE MANAGEMENT
  // ========================================
  {
    id: 'queue-stats',
    category: 'queue',
    name: 'Get Queue Statistics',
    description: 'View current queue status including pending, processing, completed and failed jobs',
    endpoint: '/api/queue/stats',
    method: 'GET',
    successMessage: 'Queue statistics retrieved successfully',
  },
  {
    id: 'queue-all-athletes',
    category: 'queue',
    name: 'Queue All Athletes',
    description: 'Add all athletes to the sync queue for batch processing',
    endpoint: '/api/queue/all',
    method: 'POST',
    parameters: [
      {
        name: 'jobType',
        type: 'select',
        label: 'Job Type',
        required: true,
        default: 'full_sync',
        options: [
          { value: 'full_sync', label: 'Full Sync (All Activities)' },
          { value: 'incremental_sync', label: 'Incremental Sync (Recent Only)' },
        ],
        description: 'Type of sync to perform',
      },
      {
        name: 'priority',
        type: 'number',
        label: 'Priority',
        default: 0,
        description: 'Higher priority jobs are processed first',
        validation: { min: -100, max: 100 },
      },
    ],
    confirmMessage: 'This will queue all athletes for syncing. Continue?',
    successMessage: 'All athletes queued successfully',
  },
  {
    id: 'queue-cleanup',
    category: 'queue',
    name: 'Cleanup Old Jobs',
    description: 'Remove completed and failed jobs older than 7 days',
    endpoint: '/api/queue/cleanup',
    method: 'POST',
    confirmMessage: 'This will delete old completed and failed jobs. Continue?',
    successMessage: 'Old jobs cleaned up successfully',
  },
  {
    id: 'queue-cancel',
    category: 'queue',
    name: 'Cancel Pending Jobs',
    description: 'Cancel specific pending jobs or clear the entire queue',
    endpoint: '/api/queue/cancel',
    method: 'POST',
    parameters: [
      {
        name: 'jobIds',
        type: 'json',
        label: 'Job IDs (Optional)',
        placeholder: '[123, 456, 789]',
        description: 'Array of job IDs to cancel. Leave empty to cancel ALL pending jobs.',
      },
    ],
    confirmMessage: 'This will cancel pending jobs. Continue?',
    successMessage: 'Pending jobs cancelled successfully',
    dangerous: true,
  },

  // ========================================
  // SYNC OPERATIONS
  // ========================================
  {
    id: 'sync-athlete',
    category: 'sync',
    name: 'Trigger Athlete Sync',
    description: 'Manually trigger a sync for a specific athlete',
    endpoint: '/api/sync/athlete/:stravaId',
    method: 'POST',
    parameters: [
      {
        name: 'stravaId',
        type: 'number',
        label: 'Strava ID',
        required: true,
        placeholder: '151622',
        description: 'The athlete\'s Strava ID',
      },
      {
        name: 'fullSync',
        type: 'checkbox',
        label: 'Full Sync',
        default: false,
        description: 'Sync all activities (otherwise incremental)',
      },
    ],
    successMessage: 'Athlete sync triggered successfully',
  },
  {
    id: 'stop-athlete-sync',
    category: 'sync',
    name: 'Stop Athlete Sync',
    description: 'Stop an in-progress sync for a specific athlete',
    endpoint: '/api/sync/stop/:stravaId',
    method: 'POST',
    parameters: [
      {
        name: 'stravaId',
        type: 'number',
        label: 'Strava ID',
        required: true,
        placeholder: '151622',
        description: 'The athlete\'s Strava ID',
      },
    ],
    confirmMessage: 'This will stop the current sync for this athlete. Continue?',
    successMessage: 'Athlete sync stopped successfully',
    dangerous: true,
  },
  {
    id: 'reset-stuck-syncs',
    category: 'sync',
    name: 'Reset Stuck Syncs',
    description: 'Reset sync status for athletes stuck in "in_progress" state',
    endpoint: '/api/sync/reset-stuck',
    method: 'POST',
    confirmMessage: 'This will reset all stuck syncs back to pending. Continue?',
    successMessage: 'Stuck syncs reset successfully',
  },

  // ========================================
  // EVENT MANAGEMENT
  // ========================================
  {
    id: 'analyze-events',
    category: 'events',
    name: 'Analyze Event Names',
    description: 'Use AI to analyze and standardize race event names',
    endpoint: '/api/event-suggestions/analyze',
    method: 'POST',
    confirmMessage: 'This will analyze all race names using AI. This may take time and use AI credits. Continue?',
    successMessage: 'Event analysis started successfully',
  },
  {
    id: 'event-stats',
    category: 'events',
    name: 'Get Event Statistics',
    description: 'View statistics about detected events and mappings',
    endpoint: '/api/events/stats',
    method: 'GET',
    successMessage: 'Event statistics retrieved successfully',
  },
  {
    id: 'rename-event',
    category: 'events',
    name: 'Rename Event',
    description: 'Rename an event across all activities',
    endpoint: '/api/events/rename',
    method: 'POST',
    parameters: [
      {
        name: 'oldName',
        type: 'text',
        label: 'Old Event Name',
        required: true,
        placeholder: 'parkrun',
        description: 'Current event name to rename',
      },
      {
        name: 'newName',
        type: 'text',
        label: 'New Event Name',
        required: true,
        placeholder: 'Parkrun',
        description: 'New event name',
      },
    ],
    confirmMessage: 'This will rename the event across all activities. Continue?',
    successMessage: 'Event renamed successfully',
  },

  // ========================================
  // RACE OPERATIONS
  // ========================================
  {
    id: 'backfill-polylines',
    category: 'races',
    name: 'Backfill Polylines',
    description: 'Download detailed polylines for races that are missing them',
    endpoint: '/api/polyline/backfill',
    method: 'POST',
    parameters: [
      {
        name: 'limit',
        type: 'number',
        label: 'Limit',
        default: 100,
        description: 'Maximum number of polylines to fetch',
        validation: { min: 1, max: 1000 },
      },
      {
        name: 'athleteId',
        type: 'number',
        label: 'Athlete ID (Optional)',
        placeholder: '42',
        description: 'Only backfill for specific athlete (leave empty for all)',
      },
    ],
    confirmMessage: 'This will fetch detailed polylines from Strava API. Continue?',
    successMessage: 'Polyline backfill started successfully',
  },
  {
    id: 'update-race-visibility',
    category: 'races',
    name: 'Update Race Visibility',
    description: 'Show or hide a specific race',
    endpoint: '/api/races/:raceId/visibility',
    method: 'PATCH',
    parameters: [
      {
        name: 'raceId',
        type: 'number',
        label: 'Race ID',
        required: true,
        placeholder: '12345',
        description: 'The race ID to update',
      },
      {
        name: 'is_hidden',
        type: 'checkbox',
        label: 'Hide Race',
        default: false,
        description: 'Check to hide race from public results',
      },
    ],
    successMessage: 'Race visibility updated successfully',
  },
  {
    id: 'bulk-hide-parkruns',
    category: 'races',
    name: 'Bulk Hide Parkruns',
    description: 'Hide all races with event name "parkrun"',
    endpoint: '/api/races/bulk-edit',
    method: 'POST',
    parameters: [
      {
        name: 'filters',
        type: 'json',
        label: 'Filters',
        default: '{"event_name": "parkrun"}',
        required: true,
        description: 'JSON filter to match races',
      },
      {
        name: 'updates',
        type: 'json',
        label: 'Updates',
        default: '{"is_hidden": true}',
        required: true,
        description: 'JSON updates to apply',
      },
    ],
    confirmMessage: 'This will hide all matching parkrun races. Continue?',
    successMessage: 'Bulk update completed successfully',
  },

  // ========================================
  // PARKRUN SPECIFIC
  // ========================================
  {
    id: 'parkrun-scrape-single',
    category: 'parkrun',
    name: 'Scrape Single Athlete',
    description: 'Open individual athlete page to scrape their parkrun history',
    endpoint: '/parkrun-individual-scraper', // This will be a special frontend-only command
    method: 'GET',
    parameters: [
      {
        name: 'parkrunAthleteId',
        type: 'text',
        label: 'Parkrun Athlete ID',
        required: true,
        placeholder: '7796495',
        description: 'The athlete\'s parkrun ID (A-number)',
      },
    ],
    successMessage: 'Opening athlete page for scraping',
  },
  {
    id: 'parkrun-scrape-batch',
    category: 'parkrun',
    name: 'Scrape All Athletes (Batch)',
    description: 'Automatically scrape all athletes\' parkrun histories in sequence',
    endpoint: '/parkrun-batch-scraper', // This will be a special frontend-only command
    method: 'GET',
    parameters: [
      {
        name: 'mode',
        type: 'select',
        label: 'Scraping Mode',
        required: true,
        default: 'new',
        options: [
          { value: 'new', label: 'New Only (Never Scraped)' },
          { value: 'all', label: 'All Athletes (Refresh)' },
        ],
        description: 'Which athletes to scrape',
      },
      {
        name: 'delay',
        type: 'number',
        label: 'Delay Between Athletes (ms)',
        default: 3000,
        description: 'Wait time between each athlete page',
        validation: { min: 1000, max: 30000 },
      },
    ],
    confirmMessage: 'This will automatically navigate through all athlete pages to scrape their parkrun histories. This may take a long time. Continue?',
    successMessage: 'Starting batch scraping',
  },
  {
    id: 'parkrun-athletes-to-scrape',
    category: 'parkrun',
    name: 'View Athletes To Scrape',
    description: 'See list of athletes that need parkrun scraping',
    endpoint: '/api/parkrun/athletes-to-scrape',
    method: 'GET',
    parameters: [
      {
        name: 'mode',
        type: 'select',
        label: 'Mode',
        default: 'new',
        options: [
          { value: 'new', label: 'New Only' },
          { value: 'all', label: 'All Athletes' },
        ],
        description: 'Filter athletes',
      },
    ],
    successMessage: 'Athletes list retrieved successfully',
  },

  // ========================================
  // ADMIN OPERATIONS
  // ========================================
  // Note: Removed non-existent endpoints:
  // - GET /api/athletes/:stravaId (doesn't exist - use /api/admin/athletes instead)
  // - GET /api/admin/stats (doesn't exist)
  {
    id: 'update-athlete-status',
    category: 'admin',
    name: 'Update Athlete Status',
    description: 'Change athlete admin, hidden, or blocked status',
    endpoint: '/api/admin/athletes/:athleteId',
    method: 'PATCH',
    parameters: [
      {
        name: 'athleteId',
        type: 'number',
        label: 'Athlete ID',
        required: true,
        placeholder: '42',
        description: 'The athlete database ID (not Strava ID)',
      },
      {
        name: 'is_admin',
        type: 'checkbox',
        label: 'Admin',
        description: 'Grant admin privileges',
      },
      {
        name: 'is_hidden',
        type: 'checkbox',
        label: 'Hidden',
        description: 'Hide from public results',
      },
      {
        name: 'is_blocked',
        type: 'checkbox',
        label: 'Blocked',
        description: 'Block from registration',
      },
    ],
    confirmMessage: 'This will update athlete status. Continue?',
    successMessage: 'Athlete status updated successfully',
  },
];

export const API_CATEGORIES = [
  { id: 'queue', label: 'Queue Management', description: 'Manage sync job queue' },
  { id: 'sync', label: 'Sync Operations', description: 'Trigger and manage athlete syncs' },
  { id: 'events', label: 'Event Management', description: 'Analyze and manage event names' },
  { id: 'races', label: 'Race Operations', description: 'Manage race data and visibility' },
  { id: 'parkrun', label: 'Parkrun', description: 'Parkrun-specific operations' },
  { id: 'admin', label: 'Admin', description: 'Administrative operations' },
];
