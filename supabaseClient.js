// Central Supabase client used by both auth + data helpers in renderer.js.
// These demo keys are safe for a hackathon prototype; rotate for production.
// Supabase UMD is loaded globally via <script src="assets/vendor/supabase.js"> in index.html.
// Ensure it exists before we try to use it.
if (!window.supabase) {
  throw new Error('Supabase SDK not loaded. Check assets/vendor/supabase.js script tag.');
}
const { createClient } = window.supabase;

export const SUPABASE_URL = 'https://rysbzmizspfuacnjgvfm.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5c2J6bWl6c3BmdWFjbmpndmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzOTg4ODAsImV4cCI6MjA4MDk3NDg4MH0.vaOqAerIqNvreFi2MIDiEgW0Ci348R6b9qtzbYZsh4s';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: (...args) => window.fetch(...args) }
});

// Helpful debug so anyone can verify which project the app is talking to.
console.log('SUPABASE_URL in use:', SUPABASE_URL);
console.log('SUPABASE_ANON_KEY ends with:', SUPABASE_ANON_KEY.slice(-6));
