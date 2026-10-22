// Live provider backed by ESPN's public scoreboard feed.
//
// This is an unofficial, undocumented feed, so treat it as best effort and expect it to change.
// Field paths used (checked against a live NBA scoreboard response):
//   events[].date, events[].status.type.state ("pre" | "in" | "post"), events[].status.period,
//   events[].competitions[0].competitors[].{homeAway, score, team.name, team.abbreviation},
//   events[].competitions[0].venue.{fullName, address.city, address.state}
// Other fields (displayName, displayClock, shortDetail) are read defensively with fallbacks.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

export const LEAGUES = {
  nba: { sport: 'basketball', slug: 'nba', name: 'NBA', periodLabel: 'Q', periods: 4 },
  wnba: { sport: 'basketball', slug: 'wnba', name: 'WNBA', periodLabel: 'Q', periods: 4 },
  nfl: { sport: 'football', slug: 'nfl', name: 'NFL', periodLabel: 'Q', periods: 4 },
  nhl: { sport: 'hockey', slug: 'nhl', name: 'NHL', periodLabel: 'P', periods: 3 },
  mlb: { sport: 'baseball', slug: 'mlb', name: 'MLB', periodLabel: 'Inning ', periods: 9, clocked: false },
  ncaaf: { sport: 'football', slug: 'college-football', name: 'College football', periodLabel: 'Q', periods: 4 },
  ncaamb: { sport: 'basketball', slug: 'mens-college-basketball', name: "Men's college basketball", periodLabel: 'Q', periods: 2 },
  epl: { sport: 'soccer', slug: 'eng.1', name: 'Premier League', periodLabel: 'H', periods: 2 },
  mls: { sport: 'soccer', slug: 'usa.1', name: 'MLS', periodLabel: 'H', periods: 2 },
};

const DEFAULT_LEAGUES = (process.env.ESPN_LEAGUES || 'nba,nfl,nhl,mlb,wnba,epl,mls').split(',').map((s) => s.trim()).filter(Boolean);

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

export function normalizeEvent(ev, leagueKey) {
  const lg = LEAGUES[leagueKey] || { name: leagueKey, periodLabel: 'P', periods: 4 };
  const comp = ev?.competitions?.[0];
  const side = (ha) => {
    const c = comp?.competitors?.find((x) => x.homeAway === ha);
    if (!c) return null;
    const t = c.team || {};
    return {
      name: t.displayName || [t.location, t.name].filter(Boolean).join(' ') || t.name || t.abbreviation || 'TBD',
      nick: t.name || '',
      abbr: t.abbreviation || '',
      score: Number(c.score ?? 0) || 0,
    };
  };
  const home = side('home');
  const away = side('away');
  if (!home || !away) return null;
  const st = ev.status || comp?.status || {};
  const state = st.type?.state || 'pre';
  const startMs = Date.parse(ev.date || comp?.date || comp?.startDate);
  if (Number.isNaN(startMs)) return null;
  // baseball has no running clock; for it the feed's own status text ("Top 7th") is used instead
  const clock =
    lg.clocked === false
      ? ''
      : st.displayClock || (state === 'in' && typeof st.clock === 'number' ? `${Math.floor(st.clock / 60)}:${String(Math.round(st.clock % 60)).padStart(2, '0')}` : '');
  return {
    id: String(ev.id),
    league: leagueKey,
    leagueName: lg.name,
    startMs,
    start: new Date(startMs).toISOString(),
    state,
    period: Number(st.period || 0),
    periods: lg.periods,
    periodLabel: lg.periodLabel,
    clock,
    detail: st.type?.shortDetail || st.type?.detail || '',
    home,
    away,
    venue: {
      name: comp?.venue?.fullName || '',
      city: comp?.venue?.address?.city || '',
      state: comp?.venue?.address?.state || '',
    },
  };
}

export function createEspnProvider({ fetchImpl = globalThis.fetch, leagues = DEFAULT_LEAGUES, timeoutMs = 8000 } = {}) {
  const cache = new Map();

  async function getJson(url, ttlMs) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < ttlMs) return hit.data;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
      const data = await res.json();
      cache.set(url, { t: Date.now(), data });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function leagueDay(key, dayMs) {
    const lg = LEAGUES[key];
    const url = `${BASE}/${lg.sport}/${lg.slug}/scoreboard?dates=${ymd(dayMs)}&limit=300`;
    // today and the past can change quickly; future days rarely do
    const ttl = dayMs <= Date.now() + 86400000 ? 30000 : 300000;
    const json = await getJson(url, ttl);
    return (json.events || []).map((e) => normalizeEvent(e, key)).filter(Boolean);
  }

  return {
    name: 'espn',
    label: 'Live ESPN data',
    leagues: () => leagues.filter((k) => LEAGUES[k]).map((k) => ({ key: k, name: LEAGUES[k].name })),
    async gamesBetween(fromMs, toMs, { league } = {}) {
      const keys = league ? [league] : leagues;
      const bad = keys.filter((k) => !LEAGUES[k]);
      if (bad.length) throw new Error(`Unknown league "${bad[0]}". Try one of: ${Object.keys(LEAGUES).join(', ')}.`);
      const days = [];
      // ESPN groups by US date, so look one day either side and filter by exact start time
      for (let d = fromMs - 86400000; d <= toMs + 86400000 && days.length < 16; d += 86400000) days.push(d);
      const jobs = keys.flatMap((k) => days.map((d) => leagueDay(k, d)));
      const settled = await Promise.allSettled(jobs);
      const ok = settled.filter((s) => s.status === 'fulfilled');
      if (!ok.length && settled.length) throw new Error(`Couldn't reach the sports feed: ${settled[0].reason?.message || 'unknown error'}`);
      const seen = new Set();
      return ok
        .flatMap((s) => s.value)
        .filter((g) => g.startMs >= fromMs && g.startMs <= toMs)
        .filter((g) => (seen.has(g.league + g.id) ? false : seen.add(g.league + g.id)))
        .sort((a, b) => a.startMs - b.startMs);
    },
  };
}
