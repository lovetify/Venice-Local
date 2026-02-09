// Deal helpers in one place so we stop copy/pasting this logic.
export function parseDeals(raw) {
  if (!raw) return [];

  const normalizeDeals = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((d) => ({
          id: d?.id || crypto.randomUUID(),
          title: d?.title || d?.text || '',
          active: d?.active !== false
        }))
        .filter((d) => d.title.trim());
    }

    if (value && typeof value === 'object') {
      const single = {
        id: value.id || crypto.randomUUID(),
        title: value.title || value.text || '',
        active: value.active !== false
      };
      return single.title.trim() ? [single] : [];
    }

    return null;
  };

  // Some rows got stringified twice, so we unwrap up to 2 rounds.
  if (typeof raw === 'string') {
    let candidate = raw.trim();
    for (let i = 0; i < 2; i += 1) {
      if (!candidate) break;
      try {
        const parsed = JSON.parse(candidate);
        const normalized = normalizeDeals(parsed);
        if (normalized) return normalized;
        if (typeof parsed === 'string') {
          candidate = parsed.trim();
          continue;
        }
        break;
      } catch {
        break;
      }
    }
  } else {
    const normalized = normalizeDeals(raw);
    if (normalized) return normalized;
  }

  // Last fallback: one line = one active deal.
  return String(raw)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((title) => ({ id: crypto.randomUUID(), title, active: true }));
}

export function serializeDeals(deals = []) {
  const cleaned = deals
    .filter((d) => d.title && d.title.trim())
    .map((d) => ({ id: d.id || crypto.randomUUID(), title: d.title.trim(), active: d.active !== false }));
  return cleaned.length ? JSON.stringify(cleaned) : '';
}
