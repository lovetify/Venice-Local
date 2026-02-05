// Central Supabase client used by both auth + data helpers in renderer.js.
// These demo keys are safe for a hackathon prototype; rotate for production.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://rysbzmizspfuacnjgvfm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5c2J6bWl6c3BmdWFjbmpndmZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzOTg4ODAsImV4cCI6MjA4MDk3NDg4MH0.vaOqAerIqNvreFi2MIDiEgW0Ci348R6b9qtzbYZsh4s';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: (...args) => window.fetch(...args) }
});

// Helpful debug so anyone can verify which project the app is talking to.
console.log('SUPABASE_URL in use:', SUPABASE_URL);
console.log('SUPABASE_ANON_KEY ends with:', SUPABASE_ANON_KEY.slice(-6));

module.exports = { supabase, SUPABASE_URL, SUPABASE_ANON_KEY };
