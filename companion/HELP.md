## Disguise Cue Control

Controls Disguise Designer (tested on r34.2) through the Session REST API and the Live Update
websocket. The cues of every track in the project are read automatically and turned into
presets - one group per track - together with the note placed on each cue.

### Configuration

**Connection**

| Field                  | Description                         |
| ---------------------- | ----------------------------------- |
| Designer IP / hostname | The director machine of the session |
| HTTP port              | Designer API port (default `80`)    |

**Cue list & presets**

| Field                                       | Description                                                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic cue list updates (Live Update)    | On: Designer pushes the cue list whenever cues or notes change. Off: no continuous load on Designer - the cue list is read on connect and by the **Refresh cue list** action only (large projects) |
| Cue list update interval (ms)               | How often Designer re-evaluates the cue list (default 3000). Each evaluation costs ~10 ms of Designer main thread per 100 tracks - larger values mean less load                                    |
| Cue presets per transport (multi-transport) | With a multi-transport, add cue and track preset groups per transport (default on). Turn off for large projects to keep the preset list short                                                      |

**Advanced** - the defaults fit most setups.

| Field                 | Description                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Polling interval (ms) | How often the list of transports in use and their setlists are read (default 2000; playmode and playhead come live through Live Update). Also the reconnect interval when Designer is unreachable (backs off up to 5 s) |
| Request timeout (ms)  | How long to wait for Designer to answer a REST request (polling and commands) before treating it as unreachable. Increase for heavy projects if you see false timeouts. Does not affect Live Update                     |

The connection status shows **Connection failure / Disconnected** while Designer is
unreachable and a warning when Designer runs but has no project open, or when the Live Update
websocket is down. The module keeps retrying and reconnects on its own.

### Actions

- **Go to cue** - jump to a CUE tag (`1`, `2.5`, `1.2.3`) with an optional playmode (Play to end
  of section by default) on a chosen transport or **Auto**. A cue on another track switches the
  transport to that track (it must be in the transport's setlist). Auto picks, in this order:
  1. the selected transport (see below), if it is on the cue's track;
  2. another transport in use that is on the cue's track;
  3. the selected transport, switching it to the cue's track;
  4. the first transport in use whose setlist contains the cue's track.
- **GO - next cue** / **BACK - previous cue** - jump to the cue after the playhead / before the
  current cue, on the transport's current track (Play to end of section by default)
- **Go to section**, **Next / Previous section**
- **Go to track**, **Next / Previous track**
- **Go to timecode**
- **Set playmode** - Play / Play to end of section / Loop section / Stop
- **Set engaged** - Toggle / Engage / Disengage a transport; each transport of a multi-transport
  separately
- **Return to start**
- **Refresh cue list** - read the cues and notes of all tracks now

All transport actions have a **Transport** option: **Current** (default) or a transport name.

The **selected transport** is the transport chosen in Designer - with a multi-transport, the one
whose timeline is selected (highlighted in the multi-transport widget). Commands without a
specific transport go to it, as Designer does itself.

### Presets

Newly added presets only change buttons placed afterwards - drag a preset again to update a placed
button.

- **Cues - Auto** - one group per track, one button per CUE tag: the note on the top, `CUE <n>`
  below. A placed button switches to `CUE <n>` alone when its cue has no note and back when a note
  is added later in Designer. Rebuilt automatically when cues are added, removed or edited. A
  button turns dark green while its cue is the current cue of any transport and dark blue while it
  is the next cue. These buttons use the Auto transport.
- **Cues - <transport>** - only with a multi-transport (and **Cue presets per transport** on): one
  section per transport, one group per track of its setlist. These cue buttons always trigger on
  that transport, light only from its playhead and show the transport name in the top right
  corner.
- **Tracks** - one button per track (name and cue count) that jumps the transport to the track
  and keeps its playmode, green while the transport is on the track: a group for the selected
  transport (every track) and, with a multi-transport and **Cue presets per transport** on, a group
  per transport (the tracks of its setlist).
- **Transport** - a group for the transport selected in Designer and one per transport in use:
  - **GO** / **BACK** - the cue they jump to with its note, or `NO CUE`;
  - Play / Section / Loop / Stop / Start / Next / Previous, lit by the playmode;
  - **Engage / disengage** - red `DISENGAGED`, green `ENGAGED`;
  - per transport also a status button: track, current cue, time - green while playing.
- **Status** - buttons without the top bar: connection, current track and playmode, **NOW** /
  **NEXT** (current and next cue of the selected transport with its note, or `NO CUE`), refresh cue
  list. With a multi-transport also **MODES**: the playmode of up to 4 transports per button, one
  row each. **Playmode per transport** - one button per transport in use with its playmode.
  Playmode buttons are colored by the playmode: green Play, blue Section, purple Loop, yellow
  Hold (end of section / track), red Stop.

### Cue highlight

The module follows the playhead of every transport in use through Live Update - one transport, or
every transport of the selected multi-transport. The current cue of a transport is the last cue at
or before its playhead, so cues started in Designer, by timecode or by another controller are
highlighted too.

### Feedbacks

- **Connected to Designer**
- **Playmode of a transport** - Play, Play to end of section (also while holding at the section
  end), Loop section, Stop, Hold section (end of section reached), Hold end (end of track
  reached); for the selected transport or a named one. Follows Designer live (also commands given
  in Designer)
- **Transport is playing** - playback is running (not stopped, not holding)
- **Transport is engaged**
- **Cue is current (playhead)** - for any transport or a selected one
- **Cue is next (playhead)** - for any transport or a selected one
- **Cue is the last triggered from Companion**
- **Track is current (playhead)** - for any transport, the selected one or a named one

### Variables

`connected`, `project`, `version`, `current_transport` (selected in Designer), `transport`,
`playmode`, `playing`, `engaged`, `track`, `track_uid` (of the selected transport, or the first in
use), `cue_count` / `cue_list` (current track), `cue_count_total`, `track_count`,
`cue_list_updated`, `last_cue`, `last_cue_note`.

Playhead of the selected transport (or the first in use): `current_cue`, `current_cue_note`,
`next_cue`, `next_cue_note`, `prev_cue`, `prev_cue_note`, `current_time`, and ready-made button
text `current_cue_label`, `next_cue_label`, `prev_cue_label` (`CUE <n>` and its note on a second
line, or `NO CUE`).

Per transport in use (`<transport>` = its name, non-alphanumeric characters as `_`):
`tr_<transport>_track`, `_cue`, `_cue_note`, `_next_cue`, `_next_cue_note`, `_prev_cue`,
`_prev_cue_note`, `_cue_label`, `_next_cue_label`, `_prev_cue_label`, `_time`, `_time_to_next` (times as `HH:MM:SS:FF` at the project refresh rate),
`_playmode`, `_playmode_short` (`PLAY`, `SECTION`, `LOOP`, `STOP`, `HOLD`, `END`), `_playing`,
`_engaged`.

Per cue: `cue_<n>_note`, `cue_<n>_time`, `cue_<n>_track`, `cue_<n>_label` (button text: the note
and `CUE <n>` on a second line, or `CUE <n>` alone) - dots in cue numbers become `_`, e.g.
`cue_1_2_note`.
