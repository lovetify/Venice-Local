// Small shared UI/data helpers.
export function calculateAverage(reviews = []) {
  if (!reviews.length) return 0;
  const sum = reviews.reduce((acc, r) => acc + Number(r.rating), 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

export function renderRatingChip(biz) {
  const rating = Number(biz?.averageRating || 0).toFixed(1);
  const reviewCount = biz?.reviews?.length || 0;
  return `<div class="rating-chip"><span class="star">⭐</span><span>${rating}</span>${reviewCount ? `<span class="rating-count">(${reviewCount})</span>` : ''}</div>`;
}

export function buildMapUrls(biz, mapsApiKey = '') {
  const query = encodeURIComponent(`${biz.name} ${biz.address}`);
  const embed = mapsApiKey
    ? `https://www.google.com/maps/embed/v1/place?key=${mapsApiKey}&q=${query}`
    : `https://www.google.com/maps?q=${query}&output=embed`;
  const link = `https://www.google.com/maps/search/?api=1&query=${query}`;
  return { embed, link };
}

export function buildAvatarPlaceholder(name = 'Guest') {
  // Quick fallback avatar if a URL is broken/missing.
  const initial = (name.trim()[0] || 'G').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" rx="18" fill="%23175f62"/><text x="50%" y="55%" font-family="Manrope, Arial, sans-serif" font-size="70" fill="%23ffffff" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
