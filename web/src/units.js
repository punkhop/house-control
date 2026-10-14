// Temperatures are kept in °C everywhere (store, devices, AI tools) and only shown in the
// unit of the Mac's region: °F in the US, °C elsewhere. A plan can force one with "units".
const FAHRENHEIT_REGIONS = new Set(['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH']);

function region() {
  try { return new Intl.Locale(navigator.language).maximize().region; } catch { return null; }
}

let fahrenheit = FAHRENHEIT_REGIONS.has(region());

/** `units` from the plan: "imperial" or "metric"; anything else keeps the region's unit. */
export function setUnits(units) {
  if (units === 'imperial') fahrenheit = true;
  else if (units === 'metric') fahrenheit = false;
}

export const tempUnit = () => (fahrenheit ? '°F' : '°C');

/** A °C value in the shown unit, rounded to `digits`. */
export function temp(celsius, digits = 0) {
  const v = fahrenheit ? celsius * 9 / 5 + 32 : celsius;
  return Number(v.toFixed(digits));
}
