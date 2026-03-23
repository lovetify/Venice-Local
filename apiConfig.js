import { SUPABASE_URL } from './supabaseClient.js';

const hostname = window.location.hostname;
const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

const LOCAL_API_BASE_URL = 'http://localhost:3000';
const DEFAULT_PROD_API_BASE_URL = `${SUPABASE_URL}/rest/v1`;
const configuredProdApiBaseUrl = window.__APP_CONFIG__?.API_BASE_URL?.trim();

export const API_BASE_URL = isLocalhost
  ? LOCAL_API_BASE_URL
  : (configuredProdApiBaseUrl || DEFAULT_PROD_API_BASE_URL);
