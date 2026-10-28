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
  of section by default). A cue on another track switches the transport to that track (it must be
  in the transport's setlist). With a multi-transport the cue goes to the first transport in use.
- **Go to section**, **Next / Previous section**
- **Go to track**, **Next / Previous track**
- **Go to timecode**
- **Play**, **Play to end of section**, **Loop section**, **Stop**, **Return to start**
- **Refresh cue list** - read the cues and notes of all tracks now

### Presets

- **Cues** - one group per track, one button per CUE tag: the note on the top, `CUE <n>` below
  (only `CUE <n>` when the cue has no note). Rebuilt automatically when cues are added, removed or
  edited; notes on already placed buttons follow edits in Designer through variables.
- **Transport** - Play / Section / Loop / Stop / Start / Next / Previous, lit by the playmode.
- **Status** - connection, current track and playmode, last triggered cue, refresh cue list.

### Feedbacks

- **Connected to Designer**
- **Playmode of the active transport**
- **Cue is the last triggered cue** (cues triggered from Companion)

### Variables

`connected`, `project`, `version`, `transport`, `playmode`, `engaged`, `track`, `track_uid`,
`cue_count` / `cue_list` (current track), `cue_count_total`, `track_count`, `cue_list_updated`,
`last_cue`, `last_cue_note` and per cue `cue_<n>_note`, `cue_<n>_time`, `cue_<n>_track`
(dots in cue numbers become `_`, e.g. `cue_1_2_note`).
