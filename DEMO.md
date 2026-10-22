# 3-minute demo script

Lead with the best material: judges are not required to watch past 3 minutes.
Use the **simulated league** (fictional teams) so no real team names or logos appear, and so everything happens in seconds.

Before recording: `npm start`, open http://localhost:8080, click **Reset demo**. Turn on **Read aloud** if you want Alexa's voice.

| Time | Do | Say or show |
| --- | --- | --- |
| 0:00 | Type "When do the Harbor Gulls play?" | The answer gives the time and the arena. Point at the "Up next" list on the screen: games today and tomorrow. |
| 0:20 | Type "Follow the Gulls and remind me an hour and 15 minutes before" | It confirms two reminders. The Gulls are now in "You're following". |
| 0:40 | Type "Update me at the end of every quarter" | Same team, new rhythm. Reminder settings were kept. |
| 0:55 | Open "What Alexa+ sent to the server" | Show the real `follow_team` tool call. This is the MCP server working. |
| 1:10 | Click **Jump to 10 min before the next game** | A reminder appears by itself: "starts in 10 minutes ... Gull Point Arena". |
| 1:30 | Click **Skip 15 min** twice | The game is live and the big score card fills in. The first quarter ends and an update arrives by itself. |
| 1:55 | Type "Follow the Owls and update me every 10 minutes" | A second team with a different rhythm. |
| 2:15 | Type "What's the score?" | Asking on demand also works. |
| 2:30 | Click **Skip 1 hour** | Finals arrive for both teams. |
| 2:45 | Say one line on live mode | "With `SPORTS_PROVIDER=espn` the same server uses real schedules and venues." Only claim this after you have run it yourself. |

## Notes

- Keep third-party trademarks and copyrighted music out of the video.
- Show the repo calling the MCP SDK (`src/server.js`) for a moment, since the track requires the code to use the technology, not only mention it.
- Say plainly that the Alexa+ screen is simulated if you did not register the server with a real Alexa+ device.
