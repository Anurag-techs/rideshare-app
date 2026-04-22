/**
 * utils/surge.js — Dynamic Surge Pricing
 *
 * Surge is applied at ride-search time; the multiplier is stored on the ride.
 * Admin can configure thresholds via .env:
 *   SURGE_PEAK_MULTIPLIER=1.2   (default 20% increase)
 *   SURGE_ENABLED=true
 */

const SURGE_ENABLED    = process.env.SURGE_ENABLED !== 'false'; // default on
const SURGE_MULTIPLIER = parseFloat(process.env.SURGE_PEAK_MULTIPLIER) || 1.2;

// Peak windows: 8–11 AM and 6–9 PM IST
const PEAK_WINDOWS = [
  { start: 8, end: 11 },
  { start: 18, end: 21 },
];

/**
 * Returns the surge multiplier for a given date (or now).
 * 1.0 = no surge, 1.2 = +20%, etc.
 */
function getSurgeMultiplier(date = new Date()) {
  if (!SURGE_ENABLED) return 1.0;
  const hour = date.getHours(); // server local hour (deploy in IST timezone)
  const isPeak = PEAK_WINDOWS.some(w => hour >= w.start && hour < w.end);
  return isPeak ? SURGE_MULTIPLIER : 1.0;
}

/**
 * Apply surge to a base price and return the result.
 */
function applyScenarios(pricePerSeat, multiplier = 1.0) {
  return parseFloat((pricePerSeat * multiplier).toFixed(2));
}

/**
 * Return human-readable surge info for the frontend.
 */
function surgeInfo(multiplier) {
  const isPeak = multiplier > 1.0;
  return {
    isPeak,
    multiplier,
    label: isPeak ? `⚡ Peak pricing (+${Math.round((multiplier - 1) * 100)}%)` : null,
    pct:   isPeak ? Math.round((multiplier - 1) * 100) : 0,
  };
}

module.exports = { getSurgeMultiplier, applyScenarios, surgeInfo };
