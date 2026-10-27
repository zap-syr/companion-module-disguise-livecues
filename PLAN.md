# Implementation plan: companion-module-disguise-livecues

Bitfocus Companion module (API `@companion-module/base` 2.1, TypeScript) for controlling
Disguise Designer: triggering cues, controlling the timeline playmode and automatically
generating presets from the cues of the current track (together with their notes).

Tested on Designer r34.2.2 (`api_test.d3starter`, localhost:80).

## Disguise API used

Session REST API only (`http://<host>:<port>/api/session/...`) - no Python execute
(it must not be polled on a timer).

| Purpose                                                     | Endpoint                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Connection check, project, version                          | `GET status/project`                                                             |
| Active transport: playmode, current track, setlist, engaged | `GET transport/activetransport`                                                  |
| Cues of the current track (CUE tag + note + section)        | `GET transport/cues?uid=<track>`                                                 |
| Track list                                                  | `GET transport/tracks`                                                           |
| Trigger a cue                                               | `POST transport/gototag` (`type: CUE`, `value`, `playmode`)                      |
| Sections                                                    | `POST transport/gotosection`, `gotonextsection`, `gotoprevsection`               |
| Playmode                                                    | `POST transport/play`, `playsection`, `playloopsection`, `stop`, `returntostart` |
| Tracks                                                      | `POST transport/gototrack`, `gotonexttrack`, `gotoprevtrack`                     |
| Timecode                                                    | `POST transport/gototimecode`                                                    |

Quirks (verified):

- The Session API answers 502 when Designer has no project running → "no project" status.
- `status.code 1000` on a GET without a track locator is only a warning; the data is complete.
- `status.code 1000` on a POST (e.g. cue not found) means the command did not apply → action error.

## Stages

### Stage 1. Configuration and stable connection - ✅

- Fields: IP/host, port (80), polling interval (ms), request timeout (ms).
- `DisguiseApi` class (`src/disguise.ts`): a single `request()` helper with a timeout
  (`AbortSignal.timeout`) that unpacks the `{status, result}` envelope.
- Polling loop (`src/main.ts`): no overlapping requests (the next poll is scheduled only
  after the current one finishes), `setTimeout` instead of `setInterval`.
- Statuses: `Connecting` → `Ok`; network unreachable → `Disconnected`/`ConnectionFailure`
  with the error text; 502 → `UnknownWarning` "no project running"; `BadConfig` without a host.
- On disconnect - automatic retries at the same interval (backing off up to 5 s);
  the status is only sent when it changes (no log spam).
- All timers are cleared in `configUpdated()` and `destroy()`.

### Stage 2. Disguise API client and actions - ✅

- Actions: Go to cue (+ playmode), Go to section, Next/Prev section, Play, Play section,
  Loop section, Stop, Return to start, Go to track (+ playmode), Next/Prev track,
  Go to timecode, Refresh cues.
- "Playmode after jump" option: don't change / Play / Play section / Loop / Stop.

### Stage 3. Automatic cue updates → presets - ✅

- Every poll reads the cues of the current track; on a change (cue added/removed, note
  edited, track switched) the presets and variable definitions are rebuilt.
- Changes are detected by a signature (JSON of the cue list); `setPresetDefinitions` is only
  called when something changed.
- One preset per cue: text `CUE <n>` + note (through the `cue_<n>_note` variable, so
  buttons already placed update their note by themselves), Go to cue action,
  "cue active" feedback (highlight).
- A separate group of transport presets (Play / Stop / Loop / Next / Prev ...).

### Stage 4. Variables and feedbacks - ✅

- Variables: `connected`, `project`, `version`, `transport`, `playmode`, `track`,
  `track_uid`, `cue_count`, `cue_list`, `cue_<n>_note`, `cue_<n>_time`, `last_cue`.
- Feedbacks: `connected`, `playmode` (selected mode), `cue_active` (last cue triggered
  from Companion).

### Stage 5. Live Update (playhead position / actual current cue) - TODO

- Websocket `ws://<host>:<port>/api/session/liveupdate`, subscribe to the playhead time of
  the active transport; derive the current cue from the cue times (`cue.time`) - to
  highlight cues not triggered from Companion (manually, by timecode).
- Variables `timecode`, `current_cue`, `next_cue`, `time_to_next_cue`.
- Afterwards - reduce the REST polling rate (cue list / transport only).

### Stage 6. Transport / track selection - TODO

- Optional selection of the transport (multi-transport) and track in the config instead of
  the "active" one.
- Presets for several tracks (setlist) - one group per track.

### Stage 7. Documentation and release - partial

- `companion/HELP.md`, `manifest.json`, `package.json` - ✅
- Upgrade scripts when options change, `yarn package`, `companion-module-check`,
  testing on a real system in Companion.
