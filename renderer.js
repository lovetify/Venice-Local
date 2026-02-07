// Renderer process logic for Venice Local
// Now uses Supabase for auth and business storage so data syncs across devices.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';

// --- Supabase configuration and asset references (updated) ---
const assetUrl = (file) => new URL(`./assets/${file}`, window.location.href).href;
const LOGO = assetUrl('venice-local.png');
const DEFAULT_AVATAR = assetUrl('Default_pfp.svg.png');
const BACKGROUND_IMAGE = assetUrl('downtown-venice.webp');
const STORAGE_BUCKET = 'business-media';
const BUSINESS_PHOTO_PLACEHOLDER = BACKGROUND_IMAGE;
const MAPS_API_KEY = 'AIzaSyCTbisKlbC0BhS0AQsuGW3YvsPSaxf3pGo';
const MAX_GALLERY_PHOTOS = 5;

// --- In-memory state for the current session ---
let currentUser = null;
let businesses = [];
let favorites = {};
let businessPhotoSupported = false;

// -----------------------------
// Utility helpers
// -----------------------------
function calculateAverage(reviews = []) {
  // Compute a rounded average rating from a list of reviews.
  if (!reviews.length) return 0;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

function buildMapUrls(biz) {
  // Prepare embed and link URLs for Google Maps.
  const query = encodeURIComponent(`${biz.name} ${biz.address}`);
  const embed = MAPS_API_KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${MAPS_API_KEY}&q=${query}`
    : `https://www.google.com/maps?q=${query}&output=embed`;
  const link = `https://www.google.com/maps/search/?api=1&query=${query}`;
  return { embed, link };
}

function mapBusinessFromDb(row) {
  // Convert a Supabase row into the shape the UI expects.
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    shortDescription: row.short_description,
    hours: row.hours,
    specialDeals: row.special_deals,
    ownerUserId: row.owner_id,
    reviews: row.reviews || [],
    averageRating: row.average_rating || 0,
    photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls : (row.photo_url ? [row.photo_url] : []),
    photoUrl: row.photo_url || ''
  };
}

function mapBusinessToDb(biz) {
  // Convert a UI business object back into a Supabase row.
  const payload = {
    id: biz.id,
    name: biz.name,
    category: biz.category,
    address: biz.address,
    short_description: biz.shortDescription,
    hours: biz.hours,
    special_deals: biz.specialDeals,
    owner_id: biz.ownerUserId,
    reviews: biz.reviews || [],
    average_rating: biz.averageRating || 0,
    photo_urls: biz.photoUrls || []
  };
  if (businessPhotoSupported && biz.photoUrl) {
    payload.photo_url = biz.photoUrl;
  }
  return payload;
}

async function fetchProfile(userId) {
  // Load a profile row for the signed-in user.
  if (!userId) return null;
  try {
    const data = await restGet(`/profiles?id=eq.${userId}&limit=1`);
    return data?.[0] || null;
  } catch (error) {
    console.warn('Profile fetch failed', error.message);
    return null;
  }
}

async function upsertProfile({ id, name, role, avatar, email }) {
  // Insert or update a profile to keep auth metadata in sync.
  const { error } = await supabase.from('profiles').upsert({
    id,
    name,
    role,
    avatar,
    email
  });
  if (error) throw error;
}

function setBusinessLoadError(message = '') {
  // Surface data loading issues in the UI.
  const el = document.getElementById('business-load-error');
  if (el) el.textContent = message;
}

async function restGet(path) {
  // Use plain fetch to Supabase REST to avoid client fetch differences across builds.
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await window.fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

async function fetchReviewsForBusinesses(ids = []) {
  // Fetch all reviews for a set of business IDs.
  if (!ids.length) return {};
  const map = {};
  try {
    const { data, error } = await supabase.from('reviews').select('*').in('business_id', ids);
    if (error) throw error;
    (data || []).forEach((r) => {
      map[r.business_id] = map[r.business_id] || [];
      map[r.business_id].push({
        userId: r.user_id,
        userName: r.user_name,
        rating: Number(r.rating),
        comment: r.comment,
        date: r.date,
        avatar: r.avatar,
        photo: r.photo || ''
      });
    });
  } catch (err) {
    console.warn('Review fetch failed; continuing without linked reviews.', err.message);
  }
  return map;
}

async function fetchBusinesses() {
  // Retrieve all businesses, attach reviews, and compute ratings.
  try {
    const data = await restGet('/businesses?select=*&order=name.asc');
    const mapped = (data ?? []).map(mapBusinessFromDb).filter(Boolean);
    const reviewMap = await fetchReviewsForBusinesses(mapped.map((b) => b.id));
    mapped.forEach((biz) => {
      const reviews = reviewMap[biz.id] || biz.reviews || [];
      biz.reviews = reviews;
      biz.averageRating = calculateAverage(reviews);
    });
    setBusinessLoadError(mapped.length ? '' : 'No businesses found in Supabase.');
    return mapped;
  } catch (err) {
    console.error('Failed to fetch businesses', err);
    const detail = err?.message || 'Unknown error';
    setBusinessLoadError(`Could not load businesses from Supabase: ${detail}. Check connection and RLS policies.`);
    return [];
  }
}

async function fetchFavoritesForUser(userId) {
  // Load the IDs the user has saved as favorites.
  if (!userId) return [];
  try {
    const data = await restGet(`/favorites?select=business_id&user_id=eq.${userId}`);
    return data.map(r => r.business_id);
  } catch (error) {
    console.warn('Favorites fetch failed', error.message);
    return [];
  }
}

async function syncBusinessesAndFavorites() {
  // Keep in-memory businesses and favorites in sync with Supabase.
  businesses = await fetchBusinesses();
  if (currentUser && currentUser.role !== 'guest') {
    const favs = await fetchFavoritesForUser(currentUser.id);
    favorites[currentUser.id] = favs;
  }
  renderBusinesses();
  renderFavoritesView();
  renderDealsView();
  if (currentUser?.role === 'owner') renderOwnerDashboard();
}

function buildAvatarPlaceholder(name = 'Guest') {
  // Generate a simple fallback SVG avatar for missing photos.
  const initial = (name.trim()[0] || 'G').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" rx="18" fill="%23175f62"/><text x="50%" y="55%" font-family="Manrope, Arial, sans-serif" font-size="70" fill="%23ffffff" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function checkBusinessPhotoSupport() {
  // Detect if the photo_url column exists before allowing uploads.
  if (businessPhotoSupported) return true;
  try {
    await restGet('/businesses?select=photo_url,photo_urls&limit=1');
    businessPhotoSupported = true;
  } catch (error) {
    businessPhotoSupported = false;
    console.warn('Business photo column missing. Add photo_url to businesses to enable photos.');
  }
  return businessPhotoSupported;
}

function readFileAsDataURL(file) {
  // Convert an uploaded file into a data URL string.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function readFilesAsDataURLs(files = []) {
  const urls = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const data = await readFileAsDataURL(file);
    urls.push(data);
    if (urls.length >= MAX_GALLERY_PHOTOS) break;
  }
  return urls;
}

function applyStaticAssets() {
  // Wire in logo and background images once the DOM is ready.
  const logoSrc = LOGO;
  document.querySelectorAll('.veniceLogo').forEach(img => {
    img.src = logoSrc;
  });
  document.documentElement.style.setProperty('--auth-bg-image', `url('${BACKGROUND_IMAGE}')`);
}

// Cloudflare Turnstile callbacks
window.onTurnstileSuccess = (token) => {
  const input = document.getElementById('turnstile-token');
  if (input) input.value = token;
};
window.onTurnstileExpired = () => {
  const input = document.getElementById('turnstile-token');
  if (input) input.value = '';
};
window.onTurnstileSignin = (token) => {
  const input = document.getElementById('signin-turnstile-token');
  if (input) input.value = token;
};
window.onTurnstileSigninExpired = () => {
  const input = document.getElementById('signin-turnstile-token');
  if (input) input.value = '';
};

function getTurnstileToken(formId) {
  // Grab the Cloudflare Turnstile token from the widget-generated hidden input,
  // with a fallback to our manual hidden field. Some browsers/ports render the
  // widget fine (green check) but never fire the callback that fills our field,
  // which led to the "Please complete the bot check" blocker.
  const form = document.getElementById(formId);
  const widgetField = form?.querySelector('input[name="cf-turnstile-response"]');
  if (widgetField?.value) return widgetField.value;

  const manualId = formId === 'signin-form' ? 'signin-turnstile-token' : 'turnstile-token';
  const manualField = document.getElementById(manualId);
  return manualField?.value || '';
}

function setView(target) {
  // Toggle between main app sections and optionally refresh owner data.
  const sections = document.querySelectorAll('.view-section');
  sections.forEach(section => {
    section.classList.add('hidden');
    section.classList.remove('animate-in');
  });
  const selected = document.getElementById(`${target}-section`);
  if (selected) {
    selected.classList.remove('hidden');
    selected.classList.add('animate-in');
    setTimeout(() => selected.classList.remove('animate-in'), 350);
    if (target === 'owner') renderOwnerDashboard();
    if (target === 'favorites') renderFavoritesView();
    if (target === 'deals') renderDealsView();
  }
}

async function uploadImage(file, folder) {
  // Upload an image to Supabase storage and return the public URL.
  const safeName = `${folder}/${crypto.randomUUID()}-${file.name.replace(/\s+/g, '-')}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(safeName, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(safeName);
  return data?.publicUrl;
}

async function resolvePhoto({ file, url, folder }) {
  // Decide whether to use an uploaded file or a direct URL.
  if (file) return uploadImage(file, folder);
  if (url) return url;
  return '';
}

function updateRoleVisibility() {
  // Show/hide owner-only UI and adjust helper text based on role.
  document.querySelectorAll('.owner-only').forEach(btn => {
    btn.style.display = currentUser && currentUser.role === 'owner' ? 'inline-flex' : 'none';
  });
  const roleNote = document.getElementById('role-note');
  const authBtn = document.getElementById('logout-btn');
  const profileForm = document.getElementById('profile-photo-form');
  const guestNote = document.getElementById('profile-guest-note');

  if (!currentUser || currentUser.role === 'guest') {
    roleNote.textContent = 'Guests can browse but must sign in to review, save favorites, or add businesses.';
    if (authBtn) authBtn.textContent = 'Sign In / Create Account';
    if (profileForm) profileForm.classList.add('hidden');
    if (guestNote) guestNote.classList.remove('hidden');
  } else if (currentUser.role === 'owner') {
    roleNote.textContent = 'Business Owners can add/edit their businesses and leave reviews.';
    if (authBtn) authBtn.textContent = 'Logout';
    if (profileForm) profileForm.classList.remove('hidden');
    if (guestNote) guestNote.classList.add('hidden');
  } else {
    roleNote.textContent = 'Local Customers can leave reviews and save favorites.';
    if (authBtn) authBtn.textContent = 'Logout';
    if (profileForm) profileForm.classList.remove('hidden');
    if (guestNote) guestNote.classList.add('hidden');
  }
}

function renderProfile() {
  // Populate profile drawer and topbar avatar with current user info.
  document.getElementById('profile-name').textContent = currentUser?.name || 'Guest';
  document.getElementById('profile-email').textContent = currentUser?.email || 'Not signed in';
  document.getElementById('profile-role').textContent = currentUser?.role || 'Guest';
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    const fallback = buildAvatarPlaceholder(currentUser?.name || 'Guest');
    const placeholder = DEFAULT_AVATAR;
    const src = currentUser?.avatar || placeholder;
    avatarEl.onerror = () => { avatarEl.onerror = null; avatarEl.src = fallback; };
    avatarEl.src = src;
    avatarEl.alt = `${currentUser?.name || 'Guest'} avatar`;
  }
  const topbarAvatar = document.getElementById('topbar-avatar');
  if (topbarAvatar) {
    const fallback = buildAvatarPlaceholder(currentUser?.name || 'Guest');
    const placeholder = DEFAULT_AVATAR;
    const src = currentUser?.avatar || placeholder;
    topbarAvatar.onerror = () => { topbarAvatar.onerror = null; topbarAvatar.src = fallback; };
    topbarAvatar.src = src;
    topbarAvatar.alt = `${currentUser?.name || 'Guest'} avatar`;
  }
}

async function updateProfilePhoto(event) {
  // Handle avatar updates via URL or uploaded file.
  event.preventDefault();
  const errorEl = document.getElementById('profile-avatar-error');
  const successEl = document.getElementById('profile-avatar-success');
  const urlInput = document.getElementById('profile-avatar-url');
  const fileInput = document.getElementById('profile-avatar-file');
  errorEl.textContent = '';
  successEl.textContent = '';

  if (!currentUser || currentUser.role === 'guest') {
    errorEl.textContent = 'Sign in to update your profile photo.';
    return;
  }

  const avatarUrl = urlInput.value.trim();
  const avatarFile = fileInput.files[0];

  if (!avatarUrl && !avatarFile) {
    errorEl.textContent = 'Provide a photo URL or upload an image.';
    return;
  }

  try {
    const avatar = avatarFile ? await readFileAsDataURL(avatarFile) : avatarUrl;
    await supabase.auth.updateUser({ data: { avatar } });
    await upsertProfile({
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      avatar,
      email: currentUser.email
    });
    currentUser.avatar = avatar;
    renderProfile();
    successEl.textContent = 'Profile photo updated.';
    document.getElementById('profile-photo-form').reset();
  } catch (err) {
    errorEl.textContent = 'Could not update photo. Try again.';
  }
}

function renderBusinesses() {
  // Render the main business list with filters and sorting.
  const listEl = document.getElementById('business-list');
  listEl.innerHTML = '';

  const searchTerm = document.getElementById('search-input').value.toLowerCase();
  const category = document.getElementById('category-filter').value;
  const sortBy = document.getElementById('sort-select').value;

  let filtered = businesses.filter(biz => {
    const matchesSearch = biz.name.toLowerCase().includes(searchTerm) || biz.shortDescription.toLowerCase().includes(searchTerm);
    const matchesCategory = category === 'all' || biz.category === category;
    return matchesSearch && matchesCategory;
  });

  if (sortBy === 'rating') {
    filtered.sort((a, b) => b.averageRating - a.averageRating);
  } else if (sortBy === 'reviews') {
    filtered.sort((a, b) => (b.reviews?.length || 0) - (a.reviews?.length || 0));
  } else if (sortBy === 'alpha') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  document.getElementById('empty-list').classList.toggle('hidden', filtered.length > 0);

  filtered.forEach(biz => {
    const card = document.createElement('div');
    card.className = 'card business-card';
    const photo = biz.photoUrl || BUSINESS_PHOTO_PLACEHOLDER;
    const hasDeal = !!biz.specialDeals;
    card.innerHTML = `
      <div class="business-photo">
        <img src="${photo}" alt="${biz.name} photo" onerror="this.onerror=null;this.src='${BUSINESS_PHOTO_PLACEHOLDER}'">
      </div>
      <div class="card-header">
        <div>
          <h3>${biz.name}</h3>
          <p class="muted">${biz.category} • ${biz.address}</p>
        </div>
        <div class="rating-chip"><span class="star">⭐</span><span>${biz.averageRating.toFixed(1)}</span></div>
      </div>
      <p class="description">${biz.shortDescription}</p>
      <div class="card-footer">
        ${hasDeal ? `<span class="deal-pill">Deals available</span>` : '<span></span>'}
        <div>
          ${renderFavoriteButton(biz.id)}
          <button class="ghost-btn" data-detail="${biz.id}">Details</button>
        </div>
      </div>
    `;
    listEl.appendChild(card);
  });

  if (currentUser?.role === 'owner') renderOwnerDashboard();
}

function renderFavoriteButton(businessId) {
  // Build a save/unsave button for the given business.
  if (!currentUser || currentUser.role === 'guest') return '';
  const saved = favorites[currentUser.id]?.includes(businessId);
  const savedClass = saved ? ' saved' : '';
  const label = saved ? '♥ Saved' : '♡ Save';
  return `<button class="secondary-btn fav-btn${savedClass}" data-fav="${businessId}">${label}</button>`;
}

function renderFavoritesView() {
  // Populate the favorites grid based on saved IDs.
  const favSection = document.getElementById('favorites-list');
  favSection.innerHTML = '';
  const favoriteIds = favorites[currentUser?.id] || [];
  const savedBusinesses = businesses.filter(b => favoriteIds.includes(b.id));
  document.getElementById('empty-favorites').classList.toggle('hidden', savedBusinesses.length > 0);

  savedBusinesses.forEach(biz => {
    const card = document.createElement('div');
    card.className = 'card business-card';
    const photo = biz.photoUrl || BUSINESS_PHOTO_PLACEHOLDER;
    const hasDeal = !!biz.specialDeals;
    card.innerHTML = `
      <div class="business-photo">
        <img src="${photo}" alt="${biz.name} photo" onerror="this.onerror=null;this.src='${BUSINESS_PHOTO_PLACEHOLDER}'">
      </div>
      <div class="card-header">
        <div>
          <h3>${biz.name}</h3>
          <p class="muted">${biz.category} • ${biz.address}</p>
        </div>
        <div class="rating-chip"><span class="star">⭐</span><span>${biz.averageRating.toFixed(1)}</span></div>
      </div>
      <p class="description">${biz.shortDescription}</p>
      <div class="card-footer">
        ${hasDeal ? `<span class="deal-pill">Deals available</span>` : '<span></span>'}
        <div>
          <button class="secondary-btn fav-btn saved" data-fav="${biz.id}">♥ Saved</button>
          <button class="ghost-btn" data-detail="${biz.id}">Details</button>
        </div>
      </div>
    `;
    favSection.appendChild(card);
  });
}

function renderDealsView() {
  // Show only businesses with an active specialDeals value.
  const dealsSection = document.getElementById('deals-list');
  if (!dealsSection) return;
  dealsSection.innerHTML = '';
  const category = document.getElementById('deals-category-filter')?.value || 'all';
  const sortBy = document.getElementById('deals-sort-select')?.value || 'rating';

  let deals = businesses.filter(b => b.specialDeals && b.specialDeals.trim());
  if (category !== 'all') {
    deals = deals.filter(b => b.category === category);
  }
  if (sortBy === 'rating') {
    deals.sort((a, b) => b.averageRating - a.averageRating);
  } else if (sortBy === 'reviews') {
    deals.sort((a, b) => (b.reviews?.length || 0) - (a.reviews?.length || 0));
  } else if (sortBy === 'alpha') {
    deals.sort((a, b) => a.name.localeCompare(b.name));
  }

  document.getElementById('empty-deals')?.classList.toggle('hidden', deals.length > 0);

  deals.forEach(biz => {
    const card = document.createElement('div');
    card.className = 'card business-card';
    const photo = biz.photoUrl || BUSINESS_PHOTO_PLACEHOLDER;
    card.innerHTML = `
      <div class="business-photo">
        <img src="${photo}" alt="${biz.name} photo" onerror="this.onerror=null;this.src='${BUSINESS_PHOTO_PLACEHOLDER}'">
      </div>
      <div class="card-header">
        <div>
          <h3>${biz.name}</h3>
          <p class="muted">${biz.category} • ${biz.address}</p>
        </div>
        <div class="rating-chip"><span class="star">⭐</span><span>${biz.averageRating.toFixed(1)}</span></div>
      </div>
      <p class="description">${biz.shortDescription}</p>
      <div class="deal-pill">Deals available</div>
      <div class="card-footer">
        <div>
          ${renderFavoriteButton(biz.id)}
          <button class="ghost-btn" data-detail="${biz.id}">Details</button>
        </div>
      </div>
    `;
    dealsSection.appendChild(card);
  });
}

function renderOwnerDashboard() {
  // Show owner stats and editable cards for businesses owned by the user.
  if (!currentUser || currentUser.role !== 'owner') return;
  const owned = businesses.filter(b => b.ownerUserId === currentUser.id);
  const totalReviews = owned.reduce((acc, biz) => acc + (biz.reviews?.length || 0), 0);
  const avgRating = owned.length
    ? (owned.reduce((acc, biz) => acc + (biz.averageRating || 0), 0) / owned.length).toFixed(1)
    : '0.0';
  const activeDeals = owned.filter(b => b.specialDeals?.trim()).length;

  const bizCountEl = document.getElementById('stat-count-businesses');
  const reviewEl = document.getElementById('stat-count-reviews');
  const ratingEl = document.getElementById('stat-avg-rating');
  const dealsEl = document.getElementById('stat-count-deals');
  if (bizCountEl) bizCountEl.textContent = owned.length;
  if (reviewEl) reviewEl.textContent = totalReviews;
  if (ratingEl) ratingEl.textContent = avgRating;
  if (dealsEl) dealsEl.textContent = activeDeals;

  const listEl = document.getElementById('owner-business-list');
  const emptyEl = document.getElementById('owner-empty');
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '';
  emptyEl.classList.toggle('hidden', owned.length > 0);

  owned.forEach(biz => {
    const card = document.createElement('div');
    card.className = 'owner-card';
    card.innerHTML = `
      <h4>${biz.name}</h4>
      <p class="meta">${biz.category} • ${biz.address}</p>
      <p class="meta">Rating: ${biz.averageRating.toFixed(1)} • Reviews: ${biz.reviews?.length || 0}</p>
      <p class="deal">${biz.specialDeals ? `Deal: ${biz.specialDeals}` : 'No deal posted yet'}</p>
      <div class="actions">
        <button class="secondary-btn" data-edit="${biz.id}">Edit</button>
        <button class="ghost-btn" data-detail="${biz.id}">View</button>
      </div>
    `;
    listEl.appendChild(card);
  });
}

// -----------------------------
// Authentication
// -----------------------------
function showAuthCard(mode = 'choice') {
  // Swap between signup, signin, and choice cards.
  const choice = document.getElementById('auth-choice-card');
  const signup = document.getElementById('signup-card');
  const signin = document.getElementById('signin-card');
  [choice, signup, signin].forEach(card => {
    if (card) card.classList.add('hidden');
  });
  if (mode === 'signup' && signup) signup.classList.remove('hidden');
  else if (mode === 'signin' && signin) signin.classList.remove('hidden');
  else if (choice) choice.classList.remove('hidden');
}

async function signUp(event) {
  // Create a new Supabase user and profile after basic human checks.
  event.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value.trim();
  const avatarUrl = document.getElementById('signup-avatar').value.trim();
  const avatarFile = document.getElementById('signup-avatar-file').files[0];
  const role = document.getElementById('signup-role').value;
  const turnstileToken = getTurnstileToken('signup-form');
  const errorEl = document.getElementById('signup-error');
  errorEl.textContent = '';

  if (!name || !email || !password || !role) {
    errorEl.textContent = 'Please fill every field and choose a role.';
    return;
  }
  if (!turnstileToken) {
    errorEl.textContent = 'Please complete the bot check.';
    return;
  }
  try {
    const avatar = avatarFile ? await readFileAsDataURL(avatarFile) : (avatarUrl || DEFAULT_AVATAR);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, role, avatar }
      }
    });
    if (error) throw error;
    const authedUser = data.user;
    await upsertProfile({ id: authedUser.id, name, role, avatar, email });
    currentUser = {
      id: authedUser.id,
      name,
      email,
      role,
      avatar
    };
    enterApp();
  } catch (err) {
    errorEl.textContent = err.message || 'Sign up failed. Please try again.';
  }
}

async function signIn(event) {
  // Sign an existing user in and hydrate profile details.
  event.preventDefault();
  const email = document.getElementById('signin-email').value.trim().toLowerCase();
  const password = document.getElementById('signin-password').value.trim();
  const turnstileToken = getTurnstileToken('signin-form');
  const errorEl = document.getElementById('signin-error');
  errorEl.textContent = '';

  if (!turnstileToken) {
    errorEl.textContent = 'Please complete the bot check.';
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.textContent = 'Invalid credentials. Please try again or create an account.';
    return;
  }

  const authedUser = data.user;
  const profile = await fetchProfile(authedUser.id);
  currentUser = {
    id: authedUser.id,
    name: profile?.name || authedUser.user_metadata?.name || authedUser.email,
    email: authedUser.email,
    role: profile?.role || authedUser.user_metadata?.role || 'patron',
    avatar: profile?.avatar || authedUser.user_metadata?.avatar || DEFAULT_AVATAR
  };
  enterApp();
}

function continueAsGuest() {
  // Let users browse without creating an account.
  currentUser = { id: 'guest', name: 'Guest', email: 'guest', role: 'guest', avatar: DEFAULT_AVATAR };
  enterApp();
}

function enterApp() {
  // Transition from auth screen into the main app shell.
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  updateRoleVisibility();
  renderProfile();
  checkBusinessPhotoSupport();
  syncBusinessesAndFavorites();
  setView('list');
}

function logout() {
  // Clear session info and return to the auth screen.
  currentUser = null;
  supabase.auth.signOut();
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('signin-form').reset();
  document.getElementById('signup-form').reset();
  showAuthCard('choice');
  const profileForm = document.getElementById('profile-photo-form');
  if (profileForm) profileForm.reset();
  const profileError = document.getElementById('profile-avatar-error');
  const profileSuccess = document.getElementById('profile-avatar-success');
  if (profileError) profileError.textContent = '';
  if (profileSuccess) profileSuccess.textContent = '';
}

// -----------------------------
// Business detail modal & reviews
// -----------------------------
function openDetail(businessId) {
  // Populate and show the business detail modal.
  const biz = businesses.find(b => b.id === businessId);
  if (!biz) return;
  const modal = document.getElementById('detail-modal');
  const body = document.getElementById('detail-body');
  const photos = biz.photoUrls?.length ? biz.photoUrls : (biz.photoUrl ? [biz.photoUrl] : []);
  const primaryPhoto = photos[0] || BUSINESS_PHOTO_PLACEHOLDER;
  const { embed: mapUrl, link: mapLink } = buildMapUrls(biz);
  const offline = typeof navigator !== 'undefined' && navigator?.onLine === false;
  const reviewsHTML = biz.reviews && biz.reviews.length
    ? biz.reviews.map(r => {
        const avatar = r.avatar || DEFAULT_AVATAR || buildAvatarPlaceholder(r.userName || 'User');
        const fallback = buildAvatarPlaceholder(r.userName || 'User');
        const reviewPhotos = r.photos && r.photos.length ? r.photos : (r.photo ? [r.photo] : []);
        const photosHtml = reviewPhotos.length
          ? `<div class="review-photos">
              ${reviewPhotos.map((p, idx) => `<img class="review-photo" data-photos="${reviewPhotos.join('|')}" data-index="${idx}" src="${p}" alt="Review from ${r.userName}" onerror="this.style.display='none'">`).join('')}
            </div>`
          : '';
        return `<div class="review">
          <div class="review-header">
            <img class="review-avatar" src="${avatar}" alt="${r.userName || 'Reviewer'} avatar" onerror="this.onerror=null;this.src='${fallback}'">
            <div>
              <div class="review-meta"><strong>${r.userName}</strong> • ${new Date(r.date).toLocaleDateString()}</div>
              <div class="review-rating">⭐ ${r.rating}</div>
            </div>
          </div>
          <p>${r.comment}</p>
          ${photosHtml}
        </div>`;
      }).join('')
    : '<p class="empty-text">Be the first to review this business!</p>';

  const canEdit = currentUser && currentUser.role === 'owner' && biz.ownerUserId === currentUser.id;
  const canReview = currentUser && currentUser.role !== 'guest';

  body.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${biz.name}</h2>
        <p class="muted">${biz.category} • ${biz.address}</p>
        <p>${biz.shortDescription}</p>
        <p><strong>Hours:</strong> ${biz.hours}</p>
      </div>
      <div class="rating-large"><span>${biz.averageRating.toFixed(1)}</span></div>
    </div>
    <div class="detail-photo">
      <img src="${primaryPhoto}" alt="${biz.name} photo" onerror="this.onerror=null;this.src='${BUSINESS_PHOTO_PLACEHOLDER}'">
    </div>
    ${photos.length > 1 ? `
    <div class="gallery-strip">
      ${photos.map((p, idx) => `
        <button class="gallery-thumb" data-photos="${photos.join('|')}" data-index="${idx}">
          <img src="${p}" alt="${biz.name} photo ${idx + 1}" onerror="this.parentElement.style.display='none'">
        </button>
      `).join('')}
    </div>
    ` : ''}
    <div class="map-shell">
      ${offline ? '' : `<iframe src="${mapUrl}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade" onerror="this.classList.add('hidden'); const f=this.nextElementSibling; if(f) f.classList.remove('hidden');"></iframe>`}
      <div class="map-fallback ${offline ? '' : 'hidden'}">
        <p><strong>Map</strong></p>
        <p class="muted small">${biz.address}</p>
        <a class="secondary-btn inline" href="${mapLink}" target="_blank" rel="noopener">Open in Google Maps</a>
      </div>
    </div>
    <div class="deal-banner">Special deals: ${biz.specialDeals || 'No deals posted yet.'}</div>
    <div class="detail-actions">
      ${renderFavoriteButton(biz.id)}
      ${canEdit ? `<button class="secondary-btn" data-edit="${biz.id}">Edit Business</button>` : ''}
    </div>
    <h3>Reviews</h3>
    <div class="reviews">${reviewsHTML}</div>
    ${canReview ? reviewFormTemplate(biz.id) : '<p class="muted">Sign in to leave a review.</p>'}
  `;

  modal.classList.remove('hidden');
}

function reviewFormTemplate(id) {
  // Lightweight template for the review form.
  return `
    <form class="review-form" data-review="${id}">
      <div class="rating-row" aria-label="Select a rating">
        <span class="rating-label">Rating</span>
        <div class="star-input" role="radiogroup">
          ${[5,4,3,2,1].map(n => `
            <input type="radio" id="star-${id}-${n}" name="rating-${id}" value="${n}">
            <label for="star-${id}-${n}" title="${n} star${n>1?'s':''}" aria-label="${n} star${n>1?'s':''}">★</label>
          `).join('')}
        </div>
      </div>
      <label>Comment<textarea rows="2" required></textarea></label>
      <label>Photos (URLs, comma or new line separated, optional)<textarea class="review-photo-url" rows="2" placeholder="https://example.com/photo.jpg"></textarea></label>
      <label>Photos (Upload multiple, optional)<input type="file" class="review-photo-file" accept="image/*" multiple></label>
      <button type="submit" class="primary-btn">Submit Review</button>
      <p class="error form-error"></p>
    </form>
  `;
}

function closeDetail() {
  // Hide the detail modal and clear old content.
  document.getElementById('detail-modal').classList.add('hidden');
  document.getElementById('detail-body').innerHTML = '';
}

async function submitReview(form) {
  // Validate and submit a new review, handling optional photo uploads.
  const bizId = form.getAttribute('data-review');
  const ratingInput = form.querySelector('input[name^="rating-"]:checked');
  const commentInput = form.querySelector('textarea');
  const photoUrlInput = form.querySelector('.review-photo-url');
  const photoFileInput = form.querySelector('.review-photo-file');
  const errorEl = form.querySelector('.form-error');
  errorEl.textContent = '';

  const rating = ratingInput ? Number(ratingInput.value) : 0;
  const comment = commentInput.value.trim();
  const photoUrlText = photoUrlInput ? photoUrlInput.value.trim() : '';
  const photoUrls = photoUrlText
    ? photoUrlText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, MAX_GALLERY_PHOTOS)
    : [];
  const photoFiles = photoFileInput ? Array.from(photoFileInput.files).slice(0, MAX_GALLERY_PHOTOS) : [];

  if (!rating || rating < 1 || rating > 5) {
    errorEl.textContent = 'Rating must be between 1 and 5.';
    return;
  }
  if (!comment) {
    errorEl.textContent = 'Please add a short comment.';
    return;
  }

  const biz = businesses.find(b => b.id === bizId);
  if (!biz) return;

  const newReview = {
    userId: currentUser.id,
    userName: currentUser.name,
    avatar: currentUser.avatar || buildAvatarPlaceholder(currentUser.name || 'User'),
    rating,
    comment,
    date: new Date().toISOString()
  };
  try {
    // Upload files and combine with URLs
    const uploaded = [];
    for (const f of photoFiles) {
      // eslint-disable-next-line no-await-in-loop
      const uploadedUrl = await resolvePhoto({ file: f, folder: `reviews/${bizId}` });
      if (uploadedUrl) uploaded.push(uploadedUrl);
    }
    const allPhotos = [...uploaded, ...photoUrls].slice(0, MAX_GALLERY_PHOTOS);
    if (allPhotos.length) {
      newReview.photos = allPhotos;
      newReview.photo = allPhotos[0];
    }

    // Primary path: insert into dedicated reviews table (works even if business row RLS blocks patrons).
    const { error: reviewInsertError } = await supabase.from('reviews').insert({
      business_id: bizId,
      user_id: newReview.userId,
      user_name: newReview.userName,
      rating: newReview.rating,
      comment: newReview.comment,
      date: newReview.date,
      avatar: newReview.avatar,
      photo: newReview.photo || '',
      photos: newReview.photos || []
    });

    if (reviewInsertError) {
      // Fallback to legacy embedded reviews on the business row.
      console.warn('Dedicated review insert failed, attempting to store on business row', reviewInsertError.message);
      biz.reviews.push(newReview);
      biz.averageRating = calculateAverage(biz.reviews);
      await supabase.from('businesses').update(mapBusinessToDb(biz)).eq('id', bizId);
    }

    await syncBusinessesAndFavorites();
    form.reset();
    openDetail(bizId); // re-render detail with new review
  } catch (err) {
    errorEl.textContent = 'Could not submit review. Please try again.';
  }
}

// -----------------------------
// Favorites
// -----------------------------
async function toggleFavorite(businessId) {
  // Save or remove a business from the user's favorites in Supabase.
  if (!currentUser || currentUser.role === 'guest') return;
  favorites[currentUser.id] = favorites[currentUser.id] || [];
  const list = favorites[currentUser.id];
  const index = list.indexOf(businessId);
  const detailModal = document.getElementById('detail-modal');
  const detailOpen = detailModal && !detailModal.classList.contains('hidden');
  try {
    if (index >= 0) {
      await supabase.from('favorites').delete().match({ user_id: currentUser.id, business_id: businessId });
      list.splice(index, 1);
    } else {
      await supabase.from('favorites').upsert({ user_id: currentUser.id, business_id: businessId });
      list.push(businessId);
    }
    await syncBusinessesAndFavorites();
    // Keep any open detail modal and existing buttons in sync with the latest save state.
    document.querySelectorAll(`[data-fav="${businessId}"]`).forEach(btn => {
      const isSaved = favorites[currentUser.id]?.includes(businessId);
      btn.textContent = isSaved ? '♡ Saved' : '♡ Save';
    });
    if (detailOpen) openDetail(businessId);
  } catch (err) {
    console.error('Favorite toggle failed', err.message);
  }
}

// -----------------------------
// Add / Edit business
// -----------------------------
async function submitBusiness(event) {
  // Add a new business or update an existing one owned by the user.
  event.preventDefault();
  if (!currentUser || currentUser.role === 'guest') {
    document.getElementById('add-error').textContent = 'Sign in as a business owner to add businesses.';
    return;
  }
  const name = document.getElementById('business-name').value.trim();
  const category = document.getElementById('business-category').value;
  const address = document.getElementById('business-address').value.trim();
  const description = document.getElementById('business-description').value.trim();
  const hours = document.getElementById('business-hours').value.trim();
  const hasDeals = document.getElementById('has-deals').checked;
  const deals = hasDeals ? document.getElementById('business-deals').value.trim() : '';
  const photoUrlRaw = document.getElementById('business-photo-url').value.trim();
  const photoUrlsInput = photoUrlRaw
    ? photoUrlRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    : [];
  const photoFiles = Array.from(document.getElementById('business-photo-file').files || []).slice(0, MAX_GALLERY_PHOTOS);
  const errorEl = document.getElementById('add-error');
  const successEl = document.getElementById('add-success');
  errorEl.textContent = '';
  successEl.textContent = '';

  if (!name || !category || !address || !description || !hours) {
    errorEl.textContent = 'All fields except deals are required.';
    return;
  }
  if (!address.toLowerCase().includes('venice')) {
    errorEl.textContent = 'Address must reference Venice, FL (downtown).';
    return;
  }

  try {
    await checkBusinessPhotoSupport();
    if ((photoUrlsInput.length || photoFiles.length) && !businessPhotoSupported) {
      errorEl.textContent = 'Business photos need a photo_url column in Supabase. Add it, then try again.';
      return;
    }

    let gallery = [];
    if (businessPhotoSupported && (photoUrlsInput.length || photoFiles.length)) {
      try {
        // Upload files first, then merge URLs; cap total.
        for (const f of photoFiles) {
          // eslint-disable-next-line no-await-in-loop
          const uploaded = await resolvePhoto({ file: f, folder: `businesses/${currentUser?.id || 'guest'}` });
          if (uploaded) gallery.push(uploaded);
          if (gallery.length >= MAX_GALLERY_PHOTOS) break;
        }
        gallery = [...gallery, ...photoUrlsInput].slice(0, MAX_GALLERY_PHOTOS);
      } catch (uploadErr) {
        errorEl.textContent = 'Could not upload business photo. Try a smaller file or provide a URL.';
        return;
      }
    }

    const primaryPhoto = gallery[0] || '';

    const editingId = event.target.getAttribute('data-editing');
    if (editingId) {
      const biz = businesses.find(b => b.id === editingId);
      if (biz && biz.ownerUserId === currentUser.id) {
        biz.name = name;
        biz.category = category;
        biz.address = address;
        biz.shortDescription = description;
        biz.hours = hours;
        biz.specialDeals = deals;
        if (businessPhotoSupported && gallery.length) {
          biz.photoUrl = primaryPhoto;
          biz.photoUrls = gallery;
        }
        const { error: updateError } = await supabase.from('businesses').update(mapBusinessToDb(biz)).eq('id', editingId);
        if (updateError) throw updateError;
      }
      event.target.removeAttribute('data-editing');
      successEl.textContent = 'Business updated successfully.';
    } else {
      const newBusiness = {
        id: crypto.randomUUID(),
        name,
        category,
        address,
        shortDescription: description,
        hours,
        specialDeals: deals,
        ownerUserId: currentUser.id,
        reviews: [],
        averageRating: 0,
        photoUrl: businessPhotoSupported ? primaryPhoto : '',
        photoUrls: businessPhotoSupported ? gallery : []
      };
      const { error: insertError } = await supabase.from('businesses').insert(mapBusinessToDb(newBusiness));
      if (insertError) throw insertError;
      businesses.push(newBusiness);
      successEl.textContent = 'Business added successfully.';
    }

    await syncBusinessesAndFavorites();
    event.target.reset();
    setView('owner'); // exit add screen after saving
  } catch (err) {
    console.error('Business save failed', err.message || err);
    errorEl.textContent = err?.message || 'Could not save business. Please try again.';
  }
}

function startEditBusiness(bizId) {
  // Pre-fill the add form with an existing business for editing.
  const biz = businesses.find(b => b.id === bizId);
  if (!biz || biz.ownerUserId !== currentUser.id) return;
  setView('add');
  const form = document.getElementById('add-business-form');
  form.setAttribute('data-editing', bizId);
  document.getElementById('business-name').value = biz.name;
  document.getElementById('business-category').value = biz.category;
  document.getElementById('business-address').value = biz.address;
  document.getElementById('business-description').value = biz.shortDescription;
  document.getElementById('business-hours').value = biz.hours;
  document.getElementById('has-deals').checked = !!biz.specialDeals;
  document.getElementById('business-deals').disabled = !biz.specialDeals;
  document.getElementById('business-deals').value = biz.specialDeals;
  const photoUrlInput = document.getElementById('business-photo-url');
  const photoFileInput = document.getElementById('business-photo-file');
  if (photoUrlInput) photoUrlInput.value = biz.photoUrl || '';
  if (photoFileInput) photoFileInput.value = '';
  document.getElementById('add-success').textContent = 'Editing your business. Save changes when ready.';
}

// -----------------------------
// Event bindings
// -----------------------------
function bindEvents() {
  // Connect UI controls to their handlers once the DOM is ready.
  document.getElementById('signup-form').addEventListener('submit', signUp);
  document.getElementById('signin-form').addEventListener('submit', signIn);
  document.getElementById('start-create-btn').addEventListener('click', () => showAuthCard('signup'));
  document.getElementById('start-signin-btn').addEventListener('click', () => showAuthCard('signin'));
  document.getElementById('guest-btn').addEventListener('click', continueAsGuest);
  document.querySelectorAll('[data-auth-back]').forEach(btn => {
    btn.addEventListener('click', () => showAuthCard('choice'));
  });
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('profile-photo-form').addEventListener('submit', updateProfilePhoto);

  document.querySelectorAll('[data-target]:not(.avatar-chip)').forEach(btn => {
    const target = btn.getAttribute('data-target');
    if (target) {
      btn.addEventListener('click', () => {
        setView(target);
      });
    }
  });

  document.querySelectorAll('.avatar-chip').forEach(chip => {
    const target = chip.getAttribute('data-target');
    if (target) {
      chip.addEventListener('click', () => setView(target));
    }
  });

  document.getElementById('search-input').addEventListener('input', renderBusinesses);
  document.getElementById('category-filter').addEventListener('change', renderBusinesses);
  document.getElementById('sort-select').addEventListener('change', renderBusinesses);
  const hasDeals = document.getElementById('has-deals');
  const dealsField = document.getElementById('business-deals');
  hasDeals.addEventListener('change', () => {
    dealsField.disabled = !hasDeals.checked;
    if (!hasDeals.checked) dealsField.value = '';
  });

  document.getElementById('business-list').addEventListener('click', (e) => {
    if (e.target.dataset.detail) {
      openDetail(e.target.dataset.detail);
    }
    if (e.target.dataset.fav) {
      toggleFavorite(e.target.dataset.fav);
    }
  });

  document.getElementById('favorites-list').addEventListener('click', (e) => {
    if (e.target.dataset.detail) openDetail(e.target.dataset.detail);
    if (e.target.dataset.fav) toggleFavorite(e.target.dataset.fav);
  });

  const dealsList = document.getElementById('deals-list');
  if (dealsList) {
    dealsList.addEventListener('click', (e) => {
      if (e.target.dataset.detail) openDetail(e.target.dataset.detail);
      if (e.target.dataset.fav) toggleFavorite(e.target.dataset.fav);
      if (e.target.dataset.photos) {
        const photos = e.target.dataset.photos.split('|').filter(Boolean);
        const start = Number(e.target.dataset.index) || 0;
        openPhotoLightbox(photos, start);
      }
    });
  }

  const dealsCategory = document.getElementById('deals-category-filter');
  const dealsSort = document.getElementById('deals-sort-select');
  if (dealsCategory) dealsCategory.addEventListener('change', renderDealsView);
  if (dealsSort) dealsSort.addEventListener('change', renderDealsView);

  const ownerList = document.getElementById('owner-business-list');
  if (ownerList) {
    ownerList.addEventListener('click', (e) => {
      if (e.target.dataset.edit) startEditBusiness(e.target.dataset.edit);
      if (e.target.dataset.detail) openDetail(e.target.dataset.detail);
    });
  }

  document.getElementById('detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal') closeDetail();
  });
  document.getElementById('close-detail').addEventListener('click', closeDetail);

  document.getElementById('detail-body').addEventListener('submit', (e) => {
    if (e.target.dataset.review) {
      e.preventDefault();
      submitReview(e.target);
    }
  });

  document.getElementById('detail-body').addEventListener('click', (e) => {
    if (e.target.dataset.fav) toggleFavorite(e.target.dataset.fav);
    if (e.target.dataset.edit) startEditBusiness(e.target.dataset.edit);
    if (e.target.dataset.photos) {
      const photos = e.target.dataset.photos.split('|').filter(Boolean);
      const start = Number(e.target.dataset.index) || 0;
      openPhotoLightbox(photos, start);
    }
    if (e.target.closest('.gallery-thumb') && e.target.closest('.gallery-thumb').dataset.photos) {
      const thumb = e.target.closest('.gallery-thumb');
      const photos = thumb.dataset.photos.split('|').filter(Boolean);
      const start = Number(thumb.dataset.index) || 0;
      openPhotoLightbox(photos, start);
    }
  });

  document.getElementById('add-business-form').addEventListener('submit', submitBusiness);

}

// -----------------------------
// Initialization
// -----------------------------
async function initSession() {
  // Restore an existing Supabase session if available.
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (session?.user) {
    const profile = await fetchProfile(session.user.id);
    currentUser = {
      id: session.user.id,
      name: profile?.name || session.user.user_metadata?.name || session.user.email,
      email: session.user.email,
      role: profile?.role || session.user.user_metadata?.role || 'patron',
      avatar: profile?.avatar || session.user.user_metadata?.avatar || DEFAULT_AVATAR
    };
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    updateRoleVisibility();
    renderProfile();
  } else {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
  }
  await checkBusinessPhotoSupport();
  await syncBusinessesAndFavorites();
}

window.addEventListener('DOMContentLoaded', () => {
  // Kick off event wiring, assets, and a fresh data sync.
  bindEvents();
  showAuthCard('choice');
  applyStaticAssets();
  setupHelpToggle();
  setupLightbox();
  initSession();

  // Disable SW caching; just clean up any old workers/caches so Supabase calls are always live in npm start, dmg, and zip.
  const CACHE_PREFIX = 'venice-local-cache';
  const cleanCachesAndWorkers = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX)).map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (err) {
      console.warn('Service worker cleanup failed.', err.message);
    }
  };

  cleanCachesAndWorkers();
});

function setupHelpToggle() {
  const openBtn = document.getElementById('help-btn');
  const panel = document.getElementById('help-panel');
  const closeBtn = document.getElementById('help-close');
  if (!openBtn || !panel || !closeBtn) return;
  const open = () => panel.classList.remove('hidden');
  const close = () => panel.classList.add('hidden');
  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  panel.addEventListener('click', (e) => {
    if (e.target === panel) close();
  });
}

// Lightbox for fullscreen viewing of gallery photos
let lightboxPhotos = [];
let lightboxIndex = 0;
function setupLightbox() {
  const lightbox = document.getElementById('photo-lightbox');
  const img = document.getElementById('lightbox-image');
  const closeBtn = document.getElementById('close-lightbox');
  const prevBtn = document.getElementById('lightbox-prev');
  const nextBtn = document.getElementById('lightbox-next');
  if (!lightbox || !img || !closeBtn || !prevBtn || !nextBtn) return;

  const render = () => {
    if (!lightboxPhotos.length) return;
    lightboxIndex = ((lightboxIndex % lightboxPhotos.length) + lightboxPhotos.length) % lightboxPhotos.length;
    img.src = lightboxPhotos[lightboxIndex];
  };

  window.openPhotoLightbox = (photos, start = 0) => {
    if (!photos || !photos.length) return;
    lightboxPhotos = photos;
    lightboxIndex = start;
    render();
    lightbox.classList.remove('hidden');
  };

  const close = () => {
    lightbox.classList.add('hidden');
    lightboxPhotos = [];
    lightboxIndex = 0;
  };

  closeBtn.addEventListener('click', close);
  lightbox.addEventListener('click', (e) => { if (e.target.id === 'photo-lightbox') close(); });
  prevBtn.addEventListener('click', () => { lightboxIndex -= 1; render(); });
  nextBtn.addEventListener('click', () => { lightboxIndex += 1; render(); });
  document.addEventListener('keydown', (e) => {
    if (lightbox.classList.contains('hidden')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') { lightboxIndex -= 1; render(); }
    if (e.key === 'ArrowRight') { lightboxIndex += 1; render(); }
  });
}
