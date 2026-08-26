import { SUPABASE_URL } from './supabaseClient.js';

const DEFAULT_PROD_API_BASE_URL = `${SUPABASE_URL}/rest/v1`;
const configuredProdApiBaseUrl = window.__APP_CONFIG__?.API_BASE_URL?.trim();

// This is a static frontend; local development uses Supabase directly too.
// A custom API base can still be supplied for a deployed environment.
export const API_BASE_URL = configuredProdApiBaseUrl || DEFAULT_PROD_API_BASE_URL;
