// Unit tests for the simulator's phrase router (no network).
import assert from 'node:assert/strict';

process.env.DEMO_NOW = '2026-10-21T16:10:00Z';
const { route, parsePrefs, parseLeads, resetSession } = await import('../src/sim.js');

const t = (text, want) => {
  resetSession();
  assert.deepEqual(route(text, { demo: true }), want, text);
};

t('When do the Harbor Gulls play?', { tool: 'next_game', args: { team: 'Harbor Gulls' } });
t('Where do the Foxes play next', { tool: 'next_game', args: { team: 'Ridge Foxes' } });
t("What's the score of the Gulls game?", { tool: 'game_status', args: { team: 'Harbor Gulls' } });
t('How are the Owls doing?', { tool: 'game_status', args: { team: 'Summit Owls' } });
t('What games are on tonight?', { tool: 'find_games', args: { day: 'tonight' } });
t('Any games tomorrow?', { tool: 'find_games', args: { day: 'tomorrow' } });
t('What are the Gulls games this week? schedule', { tool: 'find_games', args: { team: 'Harbor Gulls' } });
t('What am I following?', { tool: 'list_follows', args: {} });
t('Unfollow the Otters', { tool: 'unfollow_team', args: { team: 'Lakeside Otters' } });
t('Follow the Harbor Gulls', { tool: 'follow_team', args: { team: 'Harbor Gulls' } });

t('Follow the Gulls and remind me a day and an hour before', {
  tool: 'follow_team',
  args: { team: 'Harbor Gulls', remind_minutes_before: [1440, 60] },
});
t('Remind me 1 day, 1 hour and 15 minutes before the Foxes play', {
  tool: 'follow_team',
  args: { team: 'Ridge Foxes', remind_minutes_before: [1440, 60, 15] },
});
t('Follow the Owls and update me every 10 minutes', {
  tool: 'follow_team',
  args: { team: 'Summit Owls', update_mode: 'interval', update_every_minutes: 10 },
});
t('Follow the Bears and update me at the end of each quarter', {
  tool: 'follow_team',
  args: { team: 'Millstone Bears', update_mode: 'period' },
});
t('Follow the Herons, tell me every time they score', {
  tool: 'follow_team',
  args: { team: 'Delta Herons', update_mode: 'score' },
});
t('Follow the Gulls, just the final score', { tool: 'follow_team', args: { team: 'Harbor Gulls', update_mode: 'final' } });

// a follow-up with no team uses the last team mentioned
resetSession();
route('When do the Gulls play?', { demo: true });
assert.deepEqual(route('Update me every 15 minutes', { demo: true }), {
  tool: 'follow_team',
  args: { team: 'Harbor Gulls', update_mode: 'interval', update_every_minutes: 15 },
});
resetSession();
assert.ok(route('Remind me 30 minutes before', { demo: true }).say, 'asks which team when none is known');

// league hints pass through for live mode
resetSession();
assert.deepEqual(route('When do the Pistons play in the nba?', { demo: false }), { tool: 'next_game', args: { team: 'pistons', league: 'nba' } });

assert.deepEqual(parseLeads('half an hour and 2 hours before'), [30, 120]);
assert.deepEqual(parsePrefs("don't remind me, no updates"), { update_mode: 'none', remind_minutes_before: [] });

resetSession();
assert.ok(route('blah blah', { demo: true }).say);
console.log('route tests passed');
