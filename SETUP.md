# Private rooms setup (Firebase)

Private rooms need a Firebase Realtime Database. The daily game, archive and endless modes work without it.

1. In the Firebase console, create a project. Add a **Realtime Database** (any region).
2. Under **Authentication > Sign-in method**, enable **Anonymous**.
3. Under **Project settings > Your apps**, add a **Web app**. Copy the config values into `firebase-config.js`.
4. In the Realtime Database **Rules** tab, paste the contents of `database.rules.json` and publish.
5. Commit `firebase-config.js`. The apiKey in a Firebase web config is not a secret; the rules are what protect the data.

## Google Sheets and Apps Script

- `Historical_Scores` (Entendre Archive sheet) has a new `room_number` column F. Daily rows show `00001`.
  Private room rows carry their 5-digit room number and `mode = room`.
- Paste the updated `apps-script/Code.gs` into the Apps Script project and deploy a new version.

## Notes

- Room numbers are 5 digits from 00002 to 99999. `00001` is reserved for the daily game.
- A room number is reserved for its date in `roomCodes/<date>/<code>` and is not reused that day.
- A lobby closes 2 minutes after it opens if the host has not started it.
- Lobby capacity is checked on the phone before a player joins. Two players joining at the exact same moment could both get in
  when the room has 3 players; this is rare and harmless for a casual game.
