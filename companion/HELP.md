## Disguise Live Cues

Controls Disguise Designer (tested on r34.2) through the Session REST API and the Live Update
websocket. The cues of every track in the project are read automatically and turned into
presets - one group per track - together with the note placed on each cue.

### Configuration

| Field                                    | Description                                                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Designer IP / hostname                   | The director machine of the session                                                                                                                                                                |
| HTTP port                                | Designer API port (default `80`)                                                                                                                                                                   |
| Polling interval (ms)                    | How often the transport status is read. Also the reconnect interval when Designer is unreachable (backs off up to 5 s)                                                                             |
| Request timeout (ms)                     | Time after which a request counts as failed                                                                                                                                                        |
| Automatic cue list updates (Live Update) | On: Designer pushes the cue list whenever cues or notes change. Off: no continuous load on Designer - the cue list is read on connect and by the **Refresh cue list** action only (large projects) |
| Cue list update interval (ms)            | How often Designer re-evaluates the cue list (default 3000). Each evaluation costs ~10 ms of Designer main thread per 100 tracks - larger values mean less load                                    |

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
- **Go to section**, **Next / Previous section**
- **Go to track**, **Next / Previous track**
- **Go to timecode**
- **Play**, **Play to end of section**, **Loop section**, **Stop**, **Return to start**
- **Refresh cue list** - read the cues and notes of all tracks now

All transport actions have a **Transport** option: **Current** (default) or a transport name.

The **selected transport** is the transport chosen in Designer - with a multi-transport, the one
whose timeline is selected (highlighted in the multi-transport widget). Commands without a
specific transport go to it, as Designer does itself.

### Presets

- **Cues** - one group per track, one button per CUE tag: the note on the top, `CUE <n>` below
  (only `CUE <n>` when the cue has no note). Rebuilt automatically when cues are added, removed or
  edited; notes on already placed buttons follow edits in Designer through variables. A button
  turns dark green while its cue is the current cue of any transport and dark yellow while it is
  the next cue.
- **Transport** - Play / Section / Loop / Stop / Start / Next / Previous, lit by the playmode.
- **Status** - connection, current track and playmode, current and next cue, last triggered cue,
  refresh cue list.

### Cue highlight

The module follows the playhead of every transport in use through Live Update - one transport, or
every transport of the selected multi-transport. The current cue of a transport is the last cue at
or before its playhead, so cues started in Designer, by timecode or by another controller are
highlighted too.

### Feedbacks

- **Connected to Designer**
- **Playmode of the active transport**
- **Cue is current (playhead)** - for any transport or a selected one
- **Cue is next (playhead)** - for any transport or a selected one
- **Cue is the last triggered from Companion**

### Variables

`connected`, `project`, `version`, `current_transport` (selected in Designer), `transport`,
`playmode`, `engaged`, `track`, `track_uid` (of the selected transport, or the first in use),
`cue_count` / `cue_list` (current track), `cue_count_total`, `track_count`, `cue_list_updated`,
`last_cue`, `last_cue_note`.

Playhead of the first transport in use: `current_cue`, `current_cue_note`, `next_cue`,
`next_cue_note`, `current_time`.

Per transport in use (`<transport>` = its name, non-alphanumeric characters as `_`):
`tr_<transport>_track`, `_cue`, `_cue_note`, `_next_cue`, `_next_cue_note`, `_time`,
`_time_to_next` (times as `HH:MM:SS:FF` at the project refresh rate).

Per cue: `cue_<n>_note`, `cue_<n>_time`, `cue_<n>_track` (dots in cue numbers become `_`, e.g.
`cue_1_2_note`).
