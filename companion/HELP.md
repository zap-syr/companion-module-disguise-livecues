## Disguise Live Cues

Controls Disguise Designer (tested on r34.2) through the Session REST API.
Cues of the active track are read automatically and turned into presets, together with
the note placed on each cue.

### Configuration

| Field                  | Description                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Designer IP / hostname | The director machine of the session                                                                                        |
| HTTP port              | Designer API port (default `80`)                                                                                           |
| Polling interval (ms)  | How often status and the cue list are read. Also the reconnect interval when Designer is unreachable (backs off up to 5 s) |
| Request timeout (ms)   | Time after which a request counts as failed                                                                                |

The connection status shows **Connection failure / Disconnected** while Designer is
unreachable and a warning when Designer runs but has no project open. The module keeps
retrying and reconnects on its own.

### Actions

- **Go to cue** - jump to a CUE tag (`1`, `2.5`, `1.2.3`) with an optional playmode (Play by default)
- **Go to section**, **Next / Previous section**
- **Go to track**, **Next / Previous track**
- **Go to timecode**
- **Play**, **Play to end of section**, **Loop section**, **Stop**, **Return to start**
- **Refresh cue list**

### Presets

- **Cues** - one button per CUE tag on the active track: `CUE <n>` and the cue note.
  The list is rebuilt automatically when cues are added, removed or the track changes;
  notes on already placed buttons follow edits in Designer through variables.
- **Transport** - Play / Section / Loop / Stop / Start / Next / Previous, lit by the playmode.
- **Status** - connection, current track and playmode, last triggered cue.

### Feedbacks

- **Connected to Designer**
- **Playmode of the active transport**
- **Cue is the last triggered cue** (cues triggered from Companion)

### Variables

`connected`, `project`, `version`, `transport`, `playmode`, `engaged`, `track`, `track_uid`,
`cue_count`, `cue_list`, `last_cue`, `last_cue_note` and per cue `cue_<n>_note`, `cue_<n>_time`
(dots in cue numbers become `_`, e.g. `cue_1_2_note`).
