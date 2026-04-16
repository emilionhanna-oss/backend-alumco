function normalizeRutForStorage(raw) {
  if (raw === undefined || raw === null) return undefined;

  const cleaned = String(raw)
    .trim()
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();

  if (!cleaned) return undefined;
  if (cleaned.length === 1) return undefined;

  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1).replace(/\D/g, '');

  if (!body) return undefined;

  return `${body}${dv}`;
}

function isRutValid(raw) {
  const normalized = normalizeRutForStorage(raw);
  if (!normalized || normalized.length < 2) return false;

  const body = normalized.slice(0, -1);
  const dv = normalized.slice(-1);

  if (!/^[0-9]+$/.test(body) || !/^[0-9K]$/.test(dv)) return false;

  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  const expectedDv = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);

  return dv === expectedDv;
}

function formatRutForDisplay(raw) {
  const normalized = normalizeRutForStorage(raw);
  if (!normalized) return '';

  const body = normalized.slice(0, -1);
  const dv = normalized.slice(-1);

  const bodyWithDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${bodyWithDots}-${dv}`;
}

module.exports = {
  normalizeRutForStorage,
  isRutValid,
  formatRutForDisplay,
};
