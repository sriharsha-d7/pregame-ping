// Time helpers. The clock can be fast-forwarded so a demo can show a reminder and live score updates
// without waiting for a real game. DEMO_NOW freezes "now" (used by tests); USER_TZ sets the speaker's zone.

const frozen = process.env.DEMO_NOW ? Date.parse(process.env.DEMO_NOW) : null;
let offsetMs = 0;

export const tz = () => process.env.USER_TZ || 'America/New_York';

/** The un-advanced starting point, used to anchor the simulated league's schedule. */
export function baseMs() {
  return frozen ?? Date.now();
}

export function nowMs() {
  return (frozen ?? Date.now()) + offsetMs;
}

export function advance(minutes) {
  offsetMs += minutes * 60000;
  return nowMs();
}

export function resetClock() {
  offsetMs = 0;
}

export function offsetMinutes() {
  return Math.round(offsetMs / 60000);
}

// ---------- formatting (all in the speaker's time zone) ----------

/** YYYY-MM-DD in the speaker's zone. */
export function dayKey(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function addDaysToKey(key, n) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' });
}

function hourOf(ms) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', hour12: false }).format(new Date(ms))) % 24;
}

/** "tonight at 7:30 PM", "tomorrow at 1:00 PM", "Sat at 8:00 PM", "Sat, Nov 7 at 8:00 PM". */
export function fmtWhen(ms, ref = nowMs()) {
  const d = dayKey(ms);
  const today = dayKey(ref);
  if (d === today) return `${hourOf(ms) >= 18 ? 'tonight' : 'today'} at ${fmtTime(ms)}`;
  if (d === addDaysToKey(today, 1)) return `tomorrow at ${fmtTime(ms)}`;
  const within = [2, 3, 4, 5, 6].some((n) => d === addDaysToKey(today, n));
  const wd = new Date(ms).toLocaleDateString('en-US', { timeZone: tz(), weekday: 'short' });
  if (within) return `${wd} at ${fmtTime(ms)}`;
  const md = new Date(ms).toLocaleDateString('en-US', { timeZone: tz(), month: 'short', day: 'numeric' });
  return `${wd}, ${md} at ${fmtTime(ms)}`;
}

/** "in 45 minutes", "in 2 hours", "in 3 days"; past times read "now". */
export function fmtUntil(ms, ref = nowMs()) {
  const mins = Math.round((ms - ref) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  if (mins < 48 * 60) {
    const h = Math.round(mins / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  const days = Math.round(mins / 1440);
  return `in ${days} days`;
}

export function fmtLead(minutes) {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}
