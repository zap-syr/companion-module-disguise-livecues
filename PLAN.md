# Implementation plan: companion-module-disguise-livecues

Bitfocus Companion module (API `@companion-module/base` 2.1, TypeScript) for controlling
Disguise Designer: triggering cues on a chosen transport, controlling the timeline playmode,
automatically generating presets from the cues of every track in the project (together with
their notes) and highlighting the cue that is currently playing on each transport.

Tested on Designer r34.2.2 (`api_test.d3starter`, localhost:80), single transport and a
multi-transport (`multi` = transports `default` + `1001`).

## Disguise API used

| Purpose                                                     | API                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Connection check, project, version                          | REST `GET status/project`                                                             |
| Transports in use (1, or all children of a multi-transport) | REST `GET transport/activetransport`                                                  |
| All transports / multi-transports, setlists                 | REST `GET transport/transports`                                                       |
| Cues + notes of **all** tracks                              | Live Update subscription (one Python expression), throttled                           |
| Track + playhead of each transport in use                   | Live Update subscription per transport                                                |
| Trigger a cue on a given transport                          | REST `POST transport/gototag` (`transport`, `type: CUE`, `value`, `playmode`)         |
| Sections                                                    | REST `POST transport/gotosection`, `gotonextsection`, `gotoprevsection`               |
| Playmode                                                    | REST `POST transport/play`, `playsection`, `playloopsection`, `stop`, `returntostart` |
| Tracks                                                      | REST `POST transport/gototrack`, `gotonexttrack`, `gotoprevtrack`                     |
| Timecode                                                    | REST `POST transport/gototimecode`                                                    |
| Refresh cue list on demand                                  | Python `POST python/execute` - one-off only, never on a timer                         |

Live Update: `ws://<host>:<port>/api/session/liveupdate`. Python execute and REST reads of
continuously changing state must not be polled; Live Update pushes values instead.

### Verified quirks

REST:

- The Session API answers 502 when Designer has no project running → "no project" status.
- `status.code 1000` on a GET without a track locator is only a warning; the data is complete.
- `status.code 1000` on a POST (e.g. cue not found) means the command did not apply → action error.
- `activetransport` returns one transport, or **every child transport** when a
  multi-transport is selected - each with its own `currentTrack`, `playmode` and `setList`.
- `gototag` with a `transport` locator (uid or name) acts on that transport only.
- `gototag` with `allowGlobalJump: true` switches the transport to the track holding the cue
  (only tracks in that transport's setlist), but **always** answers `code 1000` "Not every
  transport has been moved to a specific tag", even when the jump succeeded. With
  `allowGlobalJump: false` the status is clean.

Live Update:

- A whole project's cue list can be read with one expression over `track.cues`
  (`TimeSequence[Cue]`: `n()`, `getT(i)` (beats), `getV(i)` → `Cue.getTags()`, `Cue.note`).
- The subscription pushes a new value by itself 20-90 ms after a cue is added/removed or a
  note is edited - no polling needed.
- **Throttling is mandatory.** Without `updateFrequencyMs` the expression is evaluated every
  frame: ~100 tracks dropped Designer from 193 to 108 fps (min 48). With 1000 ms there was
  no measurable average drop. One evaluation costs the main thread ~3 ms (4 tracks),
  ~9 ms (~100 tracks / ~475 cues), ~15 ms (~200 tracks) - the interval only changes how
  often this happens, so a larger interval means fewer potential frame hitches.
- An expression returning **dicts** inside nested lists silently never delivers a value;
  the same data as nested **arrays** works. Always return arrays.
- `getByUID(<uid>)` fails for transport uids (`InvalidCharacter`, uid > int64) - address
  transports as `transportManager:<name>`.
- uids must be returned as `str(...)`; as numbers they lose precision in JSON.
- Per-transport playhead: `object.player.track.beatToTime(object.player.tRender)` (seconds)
  and `str(object.player.track.uid)`.

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

- Actions: Go to cue (+ playmode, "Play to end of section" by default), Go to section,
  Next/Prev section, Play, Play section, Loop section, Stop, Return to start,
  Go to track (+ playmode), Next/Prev track, Go to timecode, Refresh cues.
- "Playmode after jump" option: don't change / Play / Play section / Loop / Stop.

### Stage 3. Automatic cue updates → presets - ✅ (current track only, replaced by 5a)

- Every poll reads the cues of the current track; on a change (cue added/removed, note
  edited, track switched) the presets and variable definitions are rebuilt.
- Changes are detected by a signature (JSON of the cue list); `setPresetDefinitions` is only
  called when something changed.
- One preset per cue, a `layered` button:
  - cue with a note: the note on the top 65 % of the button, `CUE <n>` on the bottom 35 %;
  - cue without a note: only `CUE <n>` on the whole button;
  - the note comes from the `cue_<n>_note` variable, so buttons already placed update
    their note by themselves when it is edited in Designer;
  - a full-size background box (`bg`) that the "cue active" feedback colours (since 5b:
    dark green `#006600` for the current cue, dark yellow `#663300` for the next cue).
- Wrapped in an `alternatives` preset with a `simple` fallback (note + `CUE <n>` as text)
  for hosts without layered buttons (Bitfocus Buttons).
- Cue presets run Go to cue with playmode "Play to end of section" (`PlaySection`).
- A separate group of transport presets (Play / Stop / Loop / Next / Prev ...).

### Stage 4. Variables and feedbacks - ✅

- Variables: `connected`, `project`, `version`, `transport`, `playmode`, `track`,
  `track_uid`, `cue_count`, `cue_list`, `cue_<n>_note`, `cue_<n>_time`, `last_cue`.
- Feedbacks: `connected`, `playmode` (selected mode), `cue_active` (last cue triggered
  from Companion).

### Stage 5a. Cues of all tracks via Live Update → presets per track - ✅

Implemented in `src/liveupdate.ts` (client), `src/main.ts` (cue list, connection status),
`src/config.ts` + upgrade script (new fields), `src/presets.ts` (group per track).
Verified in Companion: 19 cues on 4 tracks; a cue added in Designer appeared after ~3 s and
disappeared after removal. Interim cue triggering (until 5c): a cue on another track uses a
global jump on the **first transport in use, addressed explicitly by uid** - verified that with a
multi-transport an empty transport locator acts on a different transport (`default`) than the
first one returned by `activetransport` (`1001`).

- `src/liveupdate.ts`: Live Update websocket client (Node global `WebSocket`).
  - Connects together with the REST connection, closes with it; reconnects automatically
    and re-subscribes everything after a reconnect.
  - Subscription registry: maps the ids from the `subscriptions` message to our keys,
    unsubscribes by id (the only form Designer honours), handles `error` messages and
    `{errorType, message}` values.
  - Websocket loss while REST works → `UnknownWarning` "Live Update disconnected".
- One subscription for the whole cue list:
  - object: `transportManager:<first transport in use>` (any resolvable object works;
    re-subscribe if that transport disappears or is renamed);
  - property (arrays only, see quirks):
    `[[str(t.uid), t.description, [[g.text, t.cues.getV(i).note, t.beatToTime(t.cues.getT(i))] for i in range(t.cues.n()) for g in t.cues.getV(i).getTags() if int(g.type) == 1]] for t in resourceManager.allResources(Track) if str(t.path).startswith('objects/')]`
  - `configuration.updateFrequencyMs` = new config field
    **"Cue list update interval (ms)"**, default **3000**, range 1000-10000.
- New config checkbox **"Automatic cue list updates (Live Update)"**, default on.
  When off, there is no cue list subscription at all (zero continuous load on Designer):
  the cue list is read once on connect and then only by the **Refresh cue list** action -
  meant for large projects where the operator refreshes manually when needed. The
  interval field is hidden (`isVisibleExpression`) while the checkbox is off. The playhead
  subscriptions (5b) are not affected.
- With automatic updates on, the first value arrives right after subscribing (no wait on
  connect). The **Refresh cue list** action always re-reads immediately with one Python
  execute of the same expression.
- Variable `cue_list_updated` (time of the last cue list update) so the operator can see
  how fresh the list is in manual mode.
- REST `GET transport/cues` polling is removed; the REST poll only reads
  `activetransport` (+ project info on reconnect).
- Cue numbers are unique per project (Designer does not allow duplicates); duplicates are
  still ignored defensively (first one wins, warning in the log).
- Presets: section **Cues** with **one group per track** (group name = track name),
  ordered by the setlist of the active transport, then remaining tracks by name.
  Preset/variable ids stay `cue_<n>` / `cue_<n>_note`; new variable `cue_<n>_track`.
  Presets and variable definitions are rebuilt only when the signature changes.
- The track dropdown of Go to track is built from the same data.

### Stage 5b. Playhead per transport → current cue highlight - ✅

Implemented in `src/main.ts` (`syncPlayheads`, `setPlayhead`, `updateCurrentCue`),
`src/variables.ts`, `src/feedbacks.ts`, `src/presets.ts`. The playhead property also returns
the project refresh rate: `[str(track uid), seconds, state.globalRefreshRate.asDouble]`.
Live Update is now always connected (also with automatic cue list updates off).
Verified with a 3-transport multi-transport (`1002`, `1001`, `default`): a jump lands exactly on
the cue time (float noise only); during playback the current cue switched 3 → 4 when the
playhead crossed 105 s. Not yet verified: transport names with special characters.

- On every REST poll compare the transports returned by `activetransport` with the
  subscribed ones; subscribe new ones, unsubscribe removed ones (works the same for a
  single transport and for a multi-transport).
- One subscription per transport: object `transportManager:<name>` (spaces → `_`; verify
  names with other special characters), property
  `[str(object.player.track.uid), object.player.track.beatToTime(object.player.tRender)]`,
  `updateFrequencyMs` 150.
- Current cue of a transport = last cue of its track with `time <= playhead` (half-frame
  tolerance); next cue = the following one.
- Feedbacks and variables are only updated when the current cue / track of a transport
  changes; time variables at most every 250 ms.
- Feedbacks:
  - `cue_active` → **"Cue is current"**: true when any transport (or a selected one) is on
    that cue;
  - `cue_next` (optional colour for the next cue);
  - `cue_last_triggered` keeps the old behaviour (last cue triggered from Companion).
- Variables per transport (`tr_<name>_...`): `track`, `cue`, `cue_note`, `next_cue`,
  `next_cue_note`, `time` (HH:MM:SS:FF), `time_to_next`; global `current_cue` /
  `current_cue_note` for the first transport in use.

### Stage 5c. Transport selection for cue triggering - TODO

- Go to cue gets a **Transport** option: `Auto` (default) or a transport name
  (dropdown from `transport/transports`, custom value allowed).
- `Auto` resolves to:
  1. a transport in use that is currently on the cue's track;
  2. otherwise the first transport in use whose setlist contains the cue's track;
  3. otherwise the first transport in use.
- The module knows the cue's track (5a), so:
  - transport already on that track → `gototag` with `allowGlobalJump: false`
    (strict status check);
  - otherwise → `allowGlobalJump: true`; the known false `code 1000` is tolerated and the
    jump is confirmed through the transport's Live Update playhead (track changed within
    ~1 s), else the action fails with an error;
  - track not in the transport's setlist → action error without sending the command.
- Cue presets: transport `Auto`, playmode "Play to end of section".
- Transport option for Play / Stop / Play section / Loop / Return to start / section and
  track navigation: `Active` (default - verify how an empty locator behaves with a
  multi-transport) or a transport name.

### Stage 6. Optimisation - TODO

- Read playmode and current track from Live Update too; keep the REST poll as a heartbeat
  and transport-list check only, at a lower rate.
- Optional transport presets per transport (multi-transport setups).

### Stage 7. Documentation and release - partial

- `companion/HELP.md`, `manifest.json`, `package.json` - ✅
- Upgrade scripts when options change, `yarn package`, `companion-module-check`,
  testing on a real system in Companion.
