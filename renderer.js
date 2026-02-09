// Renderer process logic for Venice Local
// Now uses Supabase for auth and business storage so data syncs across devices.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient.js';
import { parseDeals, serializeDeals } from './modules/deals.js';
import { buildReportCsv, calculateReportData, renderReportList } from './modules/reports.js';
import { buildAvatarPlaceholder, buildMapUrls, calculateAverage, renderRatingChip } from './modules/uiUtils.js';

// --- Supabase configuration and asset references (updated) ---
const assetUrl = (file) => new URL(`./assets/${file}`, window.location.href).href;
const LOGO = assetUrl('venice-local.png');
const DEFAULT_AVATAR = assetUrl('Default_pfp.svg.png');
const BACKGROUND_IMAGE = assetUrl('downtown-venice.webp');
const STORAGE_BUCKET = 'business-media';
const BUSINESS_PHOTO_PLACEHOLDER = BACKGROUND_IMAGE;
const MAPS_API_KEY = 'AIzaSyCTbisKlbC0BhS0AQsuGW3YvsPSaxf3pGo';
const MAX_GALLERY_PHOTOS = 5;
const MAX_COUPONS = 5;

// --- In-memory state for the current session ---
let currentUser = null;
let businesses = [];
let favorites = {};
let businessPhotoSupported = false;

// -----------------------------
// Utility helpers
// -----------------------------

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
    isActive: row.is_active !== false,
    ownerUserId: row.owner_id,
    reviews: row.reviews || [],
    averageRating: row.average_rating || 0,
    photos: []
  };
}

function mapBusinessToDb(biz) {
  // Convert a UI business object back into a Supabase row.
  return {
    id: biz.id,
    name: biz.name,
    category: biz.category,
    address: biz.address,
    short_description: biz.shortDescription,
    hours: biz.hours,
    special_deals: biz.specialDeals,
    is_active: biz.isActive !== false,
    owner_id: biz.ownerUserId,
    reviews: biz.reviews || [],
    average_rating: biz.averageRating || 0
  };
}

async function fetchProfile(userId) {
  // Load a profile row for the signed-in user.
  if (!userId) return null;
  try {
    const data = await restGet(`/profiles?select=id,name,email,role,avatar&id=eq.${userId}&limit=1`);
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
  // Use plain fetch to Supabase REST and prefer the signed-in access token for RLS-protected tables.
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token || SUPABASE_ANON_KEY;
  const res = await window.fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
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

async function fetchBusinessPhotosForBusinesses(ids = []) {
  // Fetch business gallery images from the dedicated business_photos table.
  if (!ids.length) return {};
  const map = {};
  try {
    const { data, error } = await supabase
      .from('business_photos')
      .select('business_id,photo_url,sort_order,created_at')
      .in('business_id', ids)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const rows = data || [];
    // We separate "normal URLs" from storage paths because storage paths need signed links.
    const pendingSignedEntries = [];
    const signedPathSet = new Set();

    rows.forEach((row) => {
      if (!row?.business_id || !row?.photo_url) return;
      const raw = String(row.photo_url).trim();
      if (!raw) return;
      map[row.business_id] = map[row.business_id] || [];

      const storagePath = extractStoragePath(raw);
      if (!storagePath) {
        // Already public URL (or data URL) so we can keep it as-is.
        const normalizedUrl = toPublicBusinessPhotoUrl(raw);
        if (normalizedUrl) map[row.business_id].push(normalizedUrl);
        return;
      }

      signedPathSet.add(storagePath);
      pendingSignedEntries.push({ businessId: row.business_id, raw, storagePath });
    });

    if (pendingSignedEntries.length) {
      const signedMap = {};
      const paths = Array.from(signedPathSet);
      // One batch call is faster than asking Supabase for each image one by one.
      const { data: signedData, error: signedError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(paths, 60 * 60 * 24 * 7);
      if (!signedError && Array.isArray(signedData)) {
        signedData.forEach((entry, idx) => {
          const path = paths[idx];
          if (!path || entry?.error || !entry?.signedUrl) return;
          signedMap[path] = entry.signedUrl;
        });
      }

      pendingSignedEntries.forEach((entry) => {
        // Try signed URL first, then fallback to public URL path if needed.
        const resolved = signedMap[entry.storagePath] || toPublicBusinessPhotoUrl(entry.storagePath) || toPublicBusinessPhotoUrl(entry.raw);
        if (resolved) map[entry.businessId].push(resolved);
      });
    }

    Object.keys(map).forEach((businessId) => {
      map[businessId] = map[businessId].filter(Boolean);
    });
  } catch (err) {
    console.warn('Business photo fetch failed; continuing without galleries.', err.message);
  }
  return map;
}

async function fetchBusinesses() {
  // Retrieve all businesses, attach reviews, and compute ratings.
  try {
    const data = await restGet('/businesses?select=*&order=name.asc');
    const mapped = (data ?? []).map(mapBusinessFromDb).filter(Boolean);
    const ids = mapped.map((b) => b.id);
    // Pull reviews + photos together so cards/detail views are ready right away.
    const [reviewMap, photoMap] = await Promise.all([
      fetchReviewsForBusinesses(ids),
      fetchBusinessPhotosForBusinesses(ids)
    ]);
    mapped.forEach((biz) => {
      const reviews = reviewMap[biz.id] || biz.reviews || [];
      biz.reviews = reviews;
      biz.averageRating = calculateAverage(reviews);
      biz.photos = (photoMap[biz.id] || []).filter(Boolean).slice(0, MAX_GALLERY_PHOTOS);
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
  renderReportsView();
  if (currentUser?.role === 'owner') renderOwnerDashboard();
}

async function checkBusinessPhotoSupport() {
  // Detect if the business_photos table is available for business gallery uploads.
  if (businessPhotoSupported) return true;
  try {
    await restGet('/business_photos?select=business_id,photo_url&limit=1');
    businessPhotoSupported = true;
    return true;
  } catch (error) {
    businessPhotoSupported = false;
    console.warn('Business photos are disabled: business_photos table is missing or not readable.');
    return false;
  }
}

async function replaceBusinessPhotos({ businessId, photos }) {
  // Replace existing photo rows for a business with the current gallery set.
  if (!businessPhotoSupported || !businessId) return;
  const cleanUrls = (photos || []).filter(Boolean).slice(0, MAX_GALLERY_PHOTOS);

  const { error: deleteError } = await supabase
    .from('business_photos')
    .delete()
    .eq('business_id', businessId);
  if (deleteError) throw deleteError;
  if (!cleanUrls.length) return;

  const rows = cleanUrls.map((url, index) => ({
    business_id: businessId,
    photo_url: url,
    sort_order: index
  }));
  const { error: insertError } = await supabase.from('business_photos').insert(rows);
  if (insertError) throw insertError;
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
    // Tiny animation timeout so sections don't keep animating forever.
    setTimeout(() => selected.classList.remove('animate-in'), 350);
    if (target === 'owner') renderOwnerDashboard();
    if (target === 'favorites') renderFavoritesView();
    if (target === 'deals') renderDealsView();
    if (target === 'reports') renderReportsView();
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

function toPublicBusinessPhotoUrl(value) {
  // Accept full URLs or convert storage object paths into public URLs.
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  const normalizedPath = raw.replace(/^\/+/, '');
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(normalizedPath);
  return data?.publicUrl || '';
}

function extractStoragePath(value) {
  // Derive storage object path from raw path or Supabase storage URL.
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '');
  try {
    const url = new URL(raw);
    const marker = '/storage/v1/object/';
    const idx = url.pathname.indexOf(marker);
    if (idx === -1) return '';
    const suffix = url.pathname.slice(idx + marker.length); // public/<bucket>/<path> or sign/<bucket>/<path>
    const parts = suffix.split('/').filter(Boolean);
    if (parts.length < 3) return '';
    const bucket = parts[1];
    if (bucket !== STORAGE_BUCKET) return '';
    return decodeURIComponent(parts.slice(2).join('/'));
  } catch {
    return '';
  }
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

function setAvatarImage(imageEl, name, avatar) {
  // Apply avatar with a generated fallback so broken URLs still render cleanly.
  if (!imageEl) return;
  const displayName = name || 'Guest';
  const fallback = buildAvatarPlaceholder(displayName);
  const src = avatar || DEFAULT_AVATAR;
  imageEl.onerror = () => {
    imageEl.onerror = null;
    imageEl.src = fallback;
  };
  imageEl.src = src;
  imageEl.alt = `${displayName} avatar`;
}

function renderProfile() {
  // Populate profile drawer and topbar avatar with current user info.
  const name = currentUser?.name || 'Guest';
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-email').textContent = currentUser?.email || 'Not signed in';
  document.getElementById('profile-role').textContent = currentUser?.role || 'Guest';
  setAvatarImage(document.getElementById('profile-avatar'), name, currentUser?.avatar);
  setAvatarImage(document.getElementById('topbar-avatar'), name, currentUser?.avatar);
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

function sortBusinessesBySelection(items, sortBy) {
  // Tiny helper so list/deals sorting stays consistent.
  if (sortBy === 'rating') {
    items.sort((a, b) => b.averageRating - a.averageRating);
  } else if (sortBy === 'reviews') {
    items.sort((a, b) => (b.reviews?.length || 0) - (a.reviews?.length || 0));
  } else if (sortBy === 'alpha') {
    items.sort((a, b) => a.name.localeCompare(b.name));
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
    if (biz.isActive === false) return false;
    const matchesSearch = biz.name.toLowerCase().includes(searchTerm) || biz.shortDescription.toLowerCase().includes(searchTerm);
    const matchesCategory = category === 'all' || biz.category === category;
    return matchesSearch && matchesCategory;
  });

  sortBusinessesBySelection(filtered, sortBy);

  document.getElementById('empty-list').classList.toggle('hidden', filtered.length > 0);

  filtered.forEach(biz => {
    const card = document.createElement('div');
    card.className = 'card business-card';
    const photo = biz.photos?.[0] || BUSINESS_PHOTO_PLACEHOLDER;
    const hasDeal = parseDeals(biz.specialDeals).some((d) => d.active);
    card.innerHTML = `
      <div class="business-photo">
        <img src="${photo}" alt="${biz.name} photo" onerror="this.onerror=null;this.src='${BUSINESS_PHOTO_PLACEHOLDER}'">
      </div>
      <div class="card-header">
        <div>
          <h3>${biz.name}</h3>
          <p class="muted">${biz.category} • ${biz.address}</p>
        </div>
        ${renderRatingChip(biz)}
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
  const savedBusinesses = businesses.filter(b => favoriteIds.includes(b.id) && b.isActive !== false);
  document.getElementById('empty-favorites').classList.toggle('hidden', savedBusinesses.length > 0);

  savedBusinesses.forEach(biz => {
    const card = document.createElement('div');
    card.className = 'card business-card';
    const photo = biz.photos?.[0] || BUSINESS_PHOTO_PLACEHOLDER;
    const hasDeal = parseDeals(biz.specialDeals).some((d) => d.active);
    card.innerHTML = `
      <div class="business-photo">
        <img src="${photo}" alt="${biz.name} photo" onerror="this.onerror=null;this.src='${BUSINESS_PHOTO_PLACEHOLDER}'">
      </div>
      <div class="card-header">
        <div>
          <h3>${biz.name}</h3>
          <p class="muted">${biz.category} • ${biz.address}</p>
        </div>
        ${renderRatingChip(biz)}
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
  const searchTerm = document.getElementById('deals-search-input')?.value.trim().toLowerCase() || '';
  const category = document.getElementById('deals-category-filter')?.value || 'all';
  const sortBy = document.getElementById('deals-sort-select')?.value || 'rating';

  let deals = businesses.filter(b => {
    const activeDeals = parseDeals(b.specialDeals).filter((d) => d.active);
    return b.isActive !== false && activeDeals.length;
  });
  if (searchTerm) {
    deals = deals.filter((b) => {
      const dealText = parseDeals(b.specialDeals).map((d) => d.title).join(' ');
      const searchableText = `${b.name} ${b.shortDescription} ${b.address} ${dealText}`.toLowerCase();
      return searchableText.includes(searchTerm);
    });
  }
  if (category !== 'all') {
    deals = deals.filter(b => b.category === category);
  }
  sortBusinessesBySelection(deals, sortBy);

  document.getElementById('empty-deals')?.classList.toggle('hidden', deals.length > 0);

  deals.forEach(biz => {
    const card = document.createElement('div');
    card.className = 'card business-card';
    const photo = biz.photos?.[0] || BUSINESS_PHOTO_PLACEHOLDER;
    const activeDeals = parseDeals(biz.specialDeals).filter((d) => d.active);
    const coupons = activeDeals.map((d) => `
      <div class="coupon">
        <div class="coupon-body">
          <span class="coupon-title">${d.title}</span>
          <span class="coupon-status live">Active</span>
        </div>
      </div>
    `).join('');
    card.innerHTML = `
      <div class="business-photo">
        <img src="${photo}" alt="${biz.name} photo" onerror="this.onerror=null;this.src='${BUSINESS_PHOTO_PLACEHOLDER}'">
      </div>
      <div class="card-header">
        <div>
          <h3>${biz.name}</h3>
          <p class="muted">${biz.category} • ${biz.address}</p>
        </div>
        ${renderRatingChip(biz)}
      </div>
      <p class="description">${biz.shortDescription}</p>
      <div class="coupon-stack">${coupons}</div>
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
  const activeDeals = owned.reduce((acc, b) => {
    const live = parseDeals(b.specialDeals).filter((d) => d.active).length;
    return acc + (b.isActive !== false ? live : 0);
  }, 0);

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
    const isActive = biz.isActive !== false;
    const toggleLabel = isActive ? 'Set Inactive' : 'Set Active';
    const deals = parseDeals(biz.specialDeals);
    const couponsHtml = deals.length
      ? deals.map(d => `
        <div class="coupon owner ${d.active ? 'live' : 'inactive'}">
          <div class="coupon-body">
            <span class="coupon-title">${d.title}</span>
            <button class="chip ${d.active ? 'chip-live' : 'chip-inactive'}" data-toggle-deal="${biz.id}|${d.id}">
              ${d.active ? 'Active' : 'Inactive'}
            </button>
          </div>
        </div>
      `).join('')
      : '<p class="muted small">No deals posted yet.</p>';
    card.innerHTML = `
      <h4>${biz.name}</h4>
      <p class="meta">${biz.category} • ${biz.address}</p>
      <p class="meta status-row">
        <span class="status-pill ${isActive ? 'status-active' : 'status-inactive'}">
          ${isActive ? 'Active' : 'Inactive'}
        </span>
        <span class="status-note">${isActive ? 'Visible to public' : 'Hidden from public'}</span>
      </p>
      <p class="meta">Rating: ${biz.averageRating.toFixed(1)} • Reviews: ${biz.reviews?.length || 0}</p>
      <div class="coupon-stack owner-stack">
        ${couponsHtml}
      </div>
      <div class="actions">
        <button class="secondary-btn" data-toggle-active="${biz.id}">${toggleLabel}</button>
        <button class="secondary-btn" data-edit="${biz.id}">Edit</button>
        <button class="ghost-btn" data-detail="${biz.id}">View</button>
      </div>
    `;
    listEl.appendChild(card);
  });
}

function renderReportsView() {
  // Render report metrics, category summary, and ranked lists.
  const generatedEl = document.getElementById('report-generated-at');
  if (!generatedEl) return;
  const report = calculateReportData(businesses);

  generatedEl.textContent = `Generated: ${report.generatedAt.toLocaleString()}`;
  document.getElementById('report-total-businesses').textContent = report.totalBusinesses;
  document.getElementById('report-active-businesses').textContent = report.totalActiveBusinesses;
  document.getElementById('report-total-reviews').textContent = report.totalReviews;
  document.getElementById('report-average-rating').textContent = report.avgRating;
  document.getElementById('report-active-deals').textContent = report.activeDeals;

  const categoryBody = document.getElementById('report-category-body');
  if (categoryBody) {
    categoryBody.innerHTML = report.categoryRows.length
      ? report.categoryRows.map((row) => `
        <tr>
          <td>${row.category}</td>
          <td>${row.businessCount}</td>
          <td>${row.reviewCount}</td>
          <td>${row.avgRating}</td>
          <td>${row.activeDeals}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="muted">No data yet.</td></tr>';
  }

  const topRatedEl = document.getElementById('report-top-rated');
  if (topRatedEl) topRatedEl.innerHTML = renderReportList(report.topRated);
  const mostReviewedEl = document.getElementById('report-most-reviewed');
  if (mostReviewedEl) mostReviewedEl.innerHTML = renderReportList(report.mostReviewed);
}

function exportReportCsv() {
  // Download the current report data as a CSV file.
  const csv = buildReportCsv(businesses);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const link = document.createElement('a');
  link.href = url;
  link.download = `venice-local-report-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
  const canManageInactive = currentUser && currentUser.role === 'owner' && biz.ownerUserId === currentUser.id;
  if (biz.isActive === false && !canManageInactive) return;
  const modal = document.getElementById('detail-modal');
  const body = document.getElementById('detail-body');
  const photos = biz.photos || [];
  const primaryPhoto = photos[0] || BUSINESS_PHOTO_PLACEHOLDER;
  const { embed: mapUrl, link: mapLink } = buildMapUrls(biz, MAPS_API_KEY);
  const offline = typeof navigator !== 'undefined' && navigator?.onLine === false;
  const reviewCount = biz.reviews?.length || 0;
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
  const deals = parseDeals(biz.specialDeals);
  const showInactive = currentUser && currentUser.role === 'owner' && biz.ownerUserId === currentUser.id;
  const filteredDeals = showInactive ? deals : deals.filter((d) => d.active);
  const couponsHtml = deals.length
    ? filteredDeals.map(d => `
      <div class="coupon ${d.active ? 'live' : 'inactive'}">
        <div class="coupon-body">
          <span class="coupon-title">${d.title}</span>
          ${showInactive ? `<span class="coupon-status ${d.active ? 'live' : 'inactive'}">${d.active ? 'Active' : 'Inactive'}</span>` : ''}
        </div>
      </div>
    `).join('')
    : '<p class="muted">No deals posted yet.</p>';

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
    <div class="coupon-stack detail-stack">${couponsHtml}</div>
    <div class="detail-actions">
      ${renderFavoriteButton(biz.id)}
      ${canEdit ? `<button class="secondary-btn" data-edit="${biz.id}">Edit Business</button>` : ''}
    </div>
    <h3>Reviews (${reviewCount})</h3>
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
      <label>Photo URL (optional)<input type="url" class="review-photo-url" placeholder="https://example.com/photo.jpg"></label>
      <label>Photo Upload (optional, one image)<input type="file" class="review-photo-file" accept="image/*"></label>
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
  // Guard so double-clicking submit does not post duplicate reviews.
  if (form.dataset.submitting === 'true') return;
  const bizId = form.getAttribute('data-review');
  const ratingInput = form.querySelector('input[name^="rating-"]:checked');
  const commentInput = form.querySelector('textarea');
  const photoUrlInput = form.querySelector('.review-photo-url');
  const photoFileInput = form.querySelector('.review-photo-file');
  const errorEl = form.querySelector('.form-error');
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalSubmitText = submitBtn?.textContent || 'Submit Review';
  errorEl.textContent = '';
  form.dataset.submitting = 'true';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
  }

  const rating = ratingInput ? Number(ratingInput.value) : 0;
  const comment = commentInput.value.trim();
  const photoUrlText = photoUrlInput ? photoUrlInput.value.trim() : '';
  const photoFiles = photoFileInput ? Array.from(photoFileInput.files || []) : [];

  if (!rating || rating < 1 || rating > 5) {
    errorEl.textContent = 'Rating must be between 1 and 5.';
    return;
  }
  if (!comment) {
    errorEl.textContent = 'Please add a short comment.';
    return;
  }
  if (photoUrlText && /[\n,]/.test(photoUrlText)) {
    // Some people paste multiple links by accident; we only allow one image.
    errorEl.textContent = 'One image per review only.';
    return;
  }
  if (photoFiles.length > 1) {
    errorEl.textContent = 'One image per review only.';
    return;
  }
  if (photoUrlText && photoFiles.length) {
    errorEl.textContent = 'Use either one photo URL or one uploaded image.';
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
    let reviewPhoto = '';
    if (photoFiles.length) {
      reviewPhoto = await resolvePhoto({ file: photoFiles[0], folder: `reviews/${bizId}` });
    } else if (photoUrlText) {
      reviewPhoto = photoUrlText;
    }
    if (reviewPhoto) {
      newReview.photos = [reviewPhoto];
      newReview.photo = reviewPhoto;
    }

    // Try new schema first (photos[]). If that column doesn't exist, fallback to legacy schema.
    const reviewPayload = {
      business_id: bizId,
      user_id: newReview.userId,
      user_name: newReview.userName,
      rating: newReview.rating,
      comment: newReview.comment,
      date: newReview.date,
      avatar: newReview.avatar,
      photo: newReview.photo || ''
    };
    let { error: reviewInsertError } = await supabase.from('reviews').insert({
      ...reviewPayload,
      photos: newReview.photos || []
    });
    if (reviewInsertError && /Could not find the 'photos' column/i.test(reviewInsertError.message || '')) {
      ({ error: reviewInsertError } = await supabase.from('reviews').insert(reviewPayload));
    }
    if (reviewInsertError) throw reviewInsertError;

    await syncBusinessesAndFavorites();
    form.reset();
    openDetail(bizId); // re-render detail with new review
  } catch (err) {
    const detail = err?.message || '';
    if (/row-level security|permission|not authorized|denied/i.test(detail)) {
      errorEl.textContent = 'Review save blocked by Supabase policy. Check reviews INSERT policy for authenticated users.';
    } else {
      errorEl.textContent = detail || 'Could not submit review. Please try again.';
    }
  } finally {
    form.dataset.submitting = 'false';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalSubmitText;
    }
  }
}

// -----------------------------
// Favorites
// -----------------------------
async function toggleFavorite(businessId) {
  // Save or remove a business from the user's favorites in Supabase.
  if (!currentUser || currentUser.role === 'guest') return;
  const biz = businesses.find((b) => b.id === businessId);
  if (biz && biz.isActive === false) return;
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
  const form = event.target;
  // Same anti-double-submit idea as reviews.
  if (form.dataset.submitting === 'true') return;

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
  const dealsArray = [];
  if (hasDeals && window.__dealForm) {
    // Build deals from the little dynamic rows in the form.
    const { dealFields } = window.__dealForm;
    Array.from(dealFields.children).forEach((row) => {
      const title = row.querySelector('.deal-title')?.value.trim() || '';
      const active = row.querySelector('.deal-active-toggle')?.checked;
      const id = row.dataset.dealId || crypto.randomUUID();
      if (title) dealsArray.push({ id, title, active });
    });
  }
  const dealsSerialized = hasDeals ? serializeDeals(dealsArray) : '';
  const photoFiles = Array.from(document.getElementById('business-photo-file').files || []).slice(0, MAX_GALLERY_PHOTOS);
  const errorEl = document.getElementById('add-error');
  const successEl = document.getElementById('add-success');
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalSubmitText = submitBtn?.textContent || 'Save Business';
  errorEl.textContent = '';
  successEl.textContent = '';
  form.dataset.submitting = 'true';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
  }

  try {
    if (!name || !category || !address || !description || !hours) {
      errorEl.textContent = 'All fields except deals are required.';
      return;
    }
    if (!address.toLowerCase().includes('venice')) {
      errorEl.textContent = 'Address must reference Venice, FL (downtown).';
      return;
    }

    await checkBusinessPhotoSupport();
    if (photoFiles.length && !businessPhotoSupported) {
      errorEl.textContent = 'Business photos need the business_photos table in Supabase. Add it, then try again.';
      return;
    }

    const editingId = form.getAttribute('data-editing');
    const existingBiz = editingId ? businesses.find(b => b.id === editingId) : null;
    let gallery = existingBiz ? [...(existingBiz.photos || [])] : [];
    if (businessPhotoSupported && photoFiles.length) {
      try {
        // Upload files to storage and use only returned public URLs.
        const uploadedUrls = [];
        for (const f of photoFiles) {
          // eslint-disable-next-line no-await-in-loop
          const uploaded = await uploadImage(f, `businesses/${currentUser?.id || 'guest'}`);
          if (uploaded) uploadedUrls.push(uploaded);
          if (uploadedUrls.length >= MAX_GALLERY_PHOTOS) break;
        }
        gallery = uploadedUrls.slice(0, MAX_GALLERY_PHOTOS);
      } catch (uploadErr) {
        errorEl.textContent = 'Could not upload business photos. Try smaller files and try again.';
        return;
      }
    }

    if (editingId) {
      const biz = existingBiz;
      if (biz && biz.ownerUserId === currentUser.id) {
        biz.name = name;
        biz.category = category;
        biz.address = address;
        biz.shortDescription = description;
        biz.hours = hours;
        biz.specialDeals = dealsSerialized;
        if (typeof biz.isActive !== 'boolean') biz.isActive = true;
        const { error: updateError } = await supabase.from('businesses').update(mapBusinessToDb(biz)).eq('id', editingId);
        if (updateError) throw updateError;
        if (businessPhotoSupported) {
          await replaceBusinessPhotos({ businessId: editingId, photos: gallery });
        }
        biz.photos = gallery;
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
        specialDeals: dealsSerialized,
        isActive: true,
        ownerUserId: currentUser.id,
        reviews: [],
        averageRating: 0,
        photos: gallery
      };
      const { error: insertError } = await supabase.from('businesses').insert(mapBusinessToDb(newBusiness));
      if (insertError) throw insertError;
      if (businessPhotoSupported) {
        await replaceBusinessPhotos({ businessId: newBusiness.id, photos: gallery });
      }
      businesses.push(newBusiness);
      successEl.textContent = 'Business added successfully.';
    }

    await syncBusinessesAndFavorites();
    form.reset();
    if (window.__dealForm) {
      const { dealFields, updateDealsVisibility, updateDealLimitNote } = window.__dealForm;
      dealFields.innerHTML = '';
      updateDealsVisibility();
      updateDealLimitNote();
    }
    setView('owner'); // exit add screen after saving
  } catch (err) {
    console.error('Business save failed', err.message || err);
    errorEl.textContent = err?.message || 'Could not save business. Please try again.';
  } finally {
    form.dataset.submitting = 'false';
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalSubmitText;
    }
  }
}

async function toggleBusinessActive(bizId) {
  // Owners can hide/show their business from public-facing views without deleting it.
  if (!currentUser || currentUser.role !== 'owner') return;
  const biz = businesses.find((b) => b.id === bizId);
  if (!biz || biz.ownerUserId !== currentUser.id) return;

  const makingActive = biz.isActive === false;
  const prompt = makingActive
    ? `Set "${biz.name}" to Active?\n\nThis business will become visible to the public again.`
    : `Set "${biz.name}" to Inactive?\n\nThis hides it from public lists, deals, favorites, and details, but does not delete it.`;
  const confirmed = window.confirm(prompt);
  if (!confirmed) return;

  const nextActive = makingActive;
  const previousActive = biz.isActive !== false;
  biz.isActive = nextActive;

  try {
    const { error } = await supabase
      .from('businesses')
      .update({ is_active: nextActive })
      .eq('id', bizId)
      .eq('owner_id', currentUser.id);
    if (error) throw error;
    await syncBusinessesAndFavorites();
    renderOwnerDashboard();
  } catch (err) {
    biz.isActive = previousActive;
    alert(err?.message || 'Could not update business visibility.');
  }
}

async function toggleDealActive(bizId, dealId) {
  // Flip a single deal between active/inactive and persist.
  if (!currentUser || currentUser.role !== 'owner') return;
  const biz = businesses.find((b) => b.id === bizId);
  if (!biz || biz.ownerUserId !== currentUser.id) return;
  const deals = parseDeals(biz.specialDeals);
  const target = deals.find((d) => d.id === dealId);
  if (!target) return;
  target.active = !target.active;
  const next = serializeDeals(deals);
  const previous = biz.specialDeals;
  biz.specialDeals = next;

  try {
    const { error } = await supabase
      .from('businesses')
      .update({ special_deals: next })
      .eq('id', bizId)
      .eq('owner_id', currentUser.id);
    if (error) throw error;
    await syncBusinessesAndFavorites();
    renderOwnerDashboard();
    renderDealsView();
  } catch (err) {
    biz.specialDeals = previous;
    alert(err?.message || 'Could not update deal.');
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
  const deals = parseDeals(biz.specialDeals);
  const hasDeals = document.getElementById('has-deals');
  hasDeals.checked = deals.length > 0;
  if (window.__dealForm) {
    const { dealFields, addDealField, updateDealLimitNote, updateDealsVisibility } = window.__dealForm;
    dealFields.innerHTML = '';
    deals.forEach(d => addDealField(d));
    updateDealsVisibility();
    updateDealLimitNote();
  }
  const photoFileInput = document.getElementById('business-photo-file');
  if (photoFileInput) photoFileInput.value = '';
  document.getElementById('add-success').textContent = 'Editing your business. Save changes when ready.';
}

// -----------------------------
// Event bindings
// -----------------------------
function bindAuthEvents() {
  // Wire auth form actions and account controls.
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
}

function bindNavigationEvents() {
  // Handle top-level section switches.
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
}

function bindBusinessFilterEvents() {
  // Keep the main business listing in sync with filter inputs.
  document.getElementById('search-input').addEventListener('input', renderBusinesses);
  document.getElementById('category-filter').addEventListener('change', renderBusinesses);
  document.getElementById('sort-select').addEventListener('change', renderBusinesses);
  const hasDeals = document.getElementById('has-deals');
  const dealsEditor = document.getElementById('deals-editor');
  const addDealBtn = document.getElementById('add-deal-btn');
  const dealFields = document.getElementById('deal-fields');
  const limitNote = document.getElementById('deal-limit-note');

  function updateDealsVisibility() {
    // Hide whole coupon editor unless checkbox is on.
    dealsEditor.classList.toggle('hidden', !hasDeals.checked);
    if (!hasDeals.checked) {
      dealFields.innerHTML = '';
      limitNote.textContent = '';
    } else if (!dealFields.children.length) {
      addDealField();
    }
  }

  hasDeals.addEventListener('change', updateDealsVisibility);
  addDealBtn.addEventListener('click', () => addDealField());
  dealFields.addEventListener('click', (e) => {
    if (e.target.dataset.removeDeal) {
      e.target.closest('.deal-field')?.remove();
      updateDealLimitNote();
    }
  });

  function updateDealLimitNote() {
    // Quick feedback so user knows why add button is disabled.
    const count = dealFields.children.length;
    const remaining = MAX_COUPONS - count;
    limitNote.textContent = remaining <= 0
      ? 'Coupon limit reached (5). Remove one to add another.'
      : `You can add ${remaining} more coupon${remaining === 1 ? '' : 's'}.`;
    addDealBtn.disabled = count >= MAX_COUPONS;
  }

  function addDealField(deal = { id: crypto.randomUUID(), title: '', active: true }) {
    if (dealFields.children.length >= MAX_COUPONS) return;
    const row = document.createElement('div');
    row.className = 'deal-field';
    row.dataset.dealId = deal.id;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'deal-title';
    input.placeholder = '10% off for locals';
    input.value = deal.title || '';

    const activeLabel = document.createElement('label');
    activeLabel.className = 'deal-active';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'deal-active-toggle';
    checkbox.checked = deal.active !== false;
    activeLabel.appendChild(checkbox);
    activeLabel.appendChild(document.createTextNode(' Active'));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost-btn small';
    removeBtn.dataset.removeDeal = 'true';
    removeBtn.textContent = 'Remove';

    row.appendChild(input);
    row.appendChild(activeLabel);
    row.appendChild(removeBtn);
    dealFields.appendChild(row);
    updateDealLimitNote();
  }

  // We stash these on window so edit mode can rebuild this same UI later.
  window.__dealForm = { addDealField, updateDealLimitNote, dealFields, hasDeals, updateDealsVisibility };
  updateDealsVisibility();
  updateDealLimitNote();
}

function bindListEvents() {
  // Wire interactions from rendered list cards.
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

  const ownerList = document.getElementById('owner-business-list');
  if (ownerList) {
    ownerList.addEventListener('click', (e) => {
      if (e.target.dataset.toggleActive) toggleBusinessActive(e.target.dataset.toggleActive);
      if (e.target.dataset.edit) startEditBusiness(e.target.dataset.edit);
      if (e.target.dataset.detail) openDetail(e.target.dataset.detail);
      if (e.target.dataset.toggleDeal) {
        const [bizId, dealId] = e.target.dataset.toggleDeal.split('|');
        toggleDealActive(bizId, dealId);
      }
    });
  }
}

function bindDealsFilterEvents() {
  // Keep deals list filtered and sorted.
  const dealsCategory = document.getElementById('deals-category-filter');
  const dealsSort = document.getElementById('deals-sort-select');
  const dealsSearch = document.getElementById('deals-search-input');
  if (dealsCategory) dealsCategory.addEventListener('change', renderDealsView);
  if (dealsSort) dealsSort.addEventListener('change', renderDealsView);
  if (dealsSearch) dealsSearch.addEventListener('input', renderDealsView);
}

function bindReportEvents() {
  const exportBtn = document.getElementById('export-report-csv');
  if (exportBtn) exportBtn.addEventListener('click', exportReportCsv);
}

function bindModalEvents() {
  // Handle detail modal close, reviews, and gallery actions.
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
}

function bindEvents() {
  // Connect UI controls to their handlers once the DOM is ready.
  bindAuthEvents();
  bindNavigationEvents();
  bindBusinessFilterEvents();
  bindListEvents();
  bindDealsFilterEvents();
  bindReportEvents();
  bindModalEvents();

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
    // If auth session exists, hydrate profile and jump straight into app view.
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
