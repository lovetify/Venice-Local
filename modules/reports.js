import { parseDeals } from './deals.js';

// All report math lives here so renderer stays less giant.
export function calculateReportData(businesses = []) {
  const activeBusinesses = businesses.filter((b) => b.isActive !== false);
  const totalBusinesses = businesses.length;
  const totalActiveBusinesses = activeBusinesses.length;
  const totalReviews = activeBusinesses.reduce((acc, biz) => acc + (biz.reviews?.length || 0), 0);
  const avgRating = totalActiveBusinesses
    ? (activeBusinesses.reduce((acc, biz) => acc + (Number(biz.averageRating) || 0), 0) / totalActiveBusinesses).toFixed(1)
    : '0.0';
  const activeDeals = activeBusinesses.reduce((acc, biz) => acc + parseDeals(biz.specialDeals).filter((d) => d.active).length, 0);

  const categoryMap = {};
  activeBusinesses.forEach((biz) => {
    const category = biz.category || 'Uncategorized';
    categoryMap[category] = categoryMap[category] || {
      category,
      businessCount: 0,
      reviewCount: 0,
      ratingTotal: 0,
      activeDeals: 0
    };
    categoryMap[category].businessCount += 1;
    categoryMap[category].reviewCount += biz.reviews?.length || 0;
    categoryMap[category].ratingTotal += Number(biz.averageRating) || 0;
    categoryMap[category].activeDeals += parseDeals(biz.specialDeals).filter((d) => d.active).length;
  });

  const categoryRows = Object.values(categoryMap)
    .map((row) => ({
      ...row,
      avgRating: row.businessCount ? (row.ratingTotal / row.businessCount).toFixed(1) : '0.0'
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const topRated = [...activeBusinesses]
    .sort((a, b) => (Number(b.averageRating) || 0) - (Number(a.averageRating) || 0) || (b.reviews?.length || 0) - (a.reviews?.length || 0))
    .slice(0, 5);
  const mostReviewed = [...activeBusinesses]
    .sort((a, b) => (b.reviews?.length || 0) - (a.reviews?.length || 0) || (Number(b.averageRating) || 0) - (Number(a.averageRating) || 0))
    .slice(0, 5);

  return {
    generatedAt: new Date(),
    totalBusinesses,
    totalActiveBusinesses,
    totalReviews,
    avgRating,
    activeDeals,
    categoryRows,
    topRated,
    mostReviewed
  };
}

export function renderReportList(items = []) {
  if (!items.length) return '<li class="muted">No data yet.</li>';
  return items.map((biz) => {
    const reviews = biz.reviews?.length || 0;
    return `<li><strong>${biz.name}</strong> <span class="muted">(${biz.averageRating.toFixed(1)} • ${reviews} review${reviews === 1 ? '' : 's'})</span></li>`;
  }).join('');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildReportCsv(businesses = []) {
  const report = calculateReportData(businesses);
  const rows = [
    ['Venice Local Report'],
    ['Generated At', report.generatedAt.toISOString()],
    [],
    ['Summary'],
    ['Total Businesses', report.totalBusinesses],
    ['Active Businesses', report.totalActiveBusinesses],
    ['Total Reviews', report.totalReviews],
    ['Average Rating', report.avgRating],
    ['Active Deals', report.activeDeals],
    [],
    ['Category Breakdown'],
    ['Category', 'Businesses', 'Reviews', 'Avg Rating', 'Active Deals'],
    ...report.categoryRows.map((row) => [row.category, row.businessCount, row.reviewCount, row.avgRating, row.activeDeals]),
    [],
    ['Top 5 Highest Rated'],
    ['Business', 'Rating', 'Reviews'],
    ...report.topRated.map((biz) => [biz.name, biz.averageRating.toFixed(1), biz.reviews?.length || 0]),
    [],
    ['Top 5 Most Reviewed'],
    ['Business', 'Reviews', 'Rating'],
    ...report.mostReviewed.map((biz) => [biz.name, biz.reviews?.length || 0, biz.averageRating.toFixed(1)])
  ];
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}
