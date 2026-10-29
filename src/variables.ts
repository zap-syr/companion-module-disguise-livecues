import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { Cue, TransportPlayhead, TransportPlaymode } from './main.js'

/** Playmode names short enough for a button row */
const PLAYMODE_SHORT: Record<TransportPlaymode, string> = {
	Play: 'PLAY',
	PlaySection: 'SECTION',
	Loop: 'LOOP',
	Stop: 'STOP',
	HoldSection: 'HOLD',
	HoldEnd: 'END',
	'': '',
}

// Created dynamically: per cue (cue_<id>_note, cue_<id>_time, cue_<id>_track) for every cue of the
// project, and per transport in use (tr_<transport>_...) from its Live Update playhead
export type VariablesSchema = CompanionVariableValues

const PLAYHEAD_VARIABLES: [suffix: string, name: string][] = [
	['track', 'current track'],
	['cue', 'current cue'],
	['cue_note', 'note of the current cue'],
	['next_cue', 'next cue'],
	['next_cue_note', 'note of the next cue'],
	['prev_cue', 'previous cue (before the current one)'],
	['prev_cue_note', 'note of the previous cue'],
	['cue_label', 'button text of the current cue (CUE <n> and its note, or NO CUE)'],
	['next_cue_label', 'button text of the next cue'],
	['prev_cue_label', 'button text of the previous cue'],
	['time', 'playhead (HH:MM:SS:FF)'],
	['time_to_next', 'time to the next cue (HH:MM:SS:FF)'],
	['playmode', 'playmode (Play, PlaySection, Loop, Stop, HoldSection, HoldEnd)'],
	['playmode_short', 'playmode, short for buttons (PLAY, SECTION, LOOP, STOP, HOLD, END)'],
	['playing', 'playing (true/false)'],
	['engaged', 'engaged (true/false)'],
]

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		connected: { name: 'Connected to Designer (true/false)' },
		project: { name: 'Project path' },
		version: { name: 'Designer version' },
		current_transport: { name: 'Transport selected in Designer (multi-transport: the selected timeline)' },
		transport: { name: 'Main transport: the selected one when in use, else the first in use' },
		playmode: { name: 'Playmode of the main transport (Play, PlaySection, Loop, Stop, HoldSection, HoldEnd)' },
		playing: { name: 'Main transport is playing (true/false)' },
		engaged: { name: 'Main transport engaged (true/false)' },
		track: { name: 'Current track of the main transport' },
		track_uid: { name: 'Current track uid of the main transport' },
		cue_count: { name: 'Number of cues on the current track' },
		cue_list: { name: 'Cues on the current track (comma separated)' },
		cue_count_total: { name: 'Number of cues in the project (all tracks)' },
		track_count: { name: 'Number of tracks in the project' },
		cue_list_updated: { name: 'Time of the last cue list update' },
		last_cue: { name: 'Last cue triggered from Companion' },
		last_cue_note: { name: 'Note of the last cue triggered from Companion' },
		current_cue: { name: 'Current cue of the selected transport' },
		current_cue_note: { name: 'Note of the current cue of the selected transport' },
		next_cue: { name: 'Next cue of the selected transport' },
		next_cue_note: { name: 'Note of the next cue of the selected transport' },
		prev_cue: { name: 'Previous cue (before the current one) of the selected transport' },
		prev_cue_note: { name: 'Note of the previous cue of the selected transport' },
		current_time: { name: 'Playhead of the selected transport (HH:MM:SS:FF)' },
		current_cue_label: { name: 'Button text of the current cue: CUE <n> and its note, or NO CUE' },
		next_cue_label: { name: 'Button text of the next cue: CUE <n> and its note, or NO CUE' },
		prev_cue_label: { name: 'Button text of the previous cue: CUE <n> and its note, or NO CUE' },
	}

	for (const playhead of self.state.playheads) {
		for (const [suffix, name] of PLAYHEAD_VARIABLES) {
			definitions[`tr_${playhead.varId}_${suffix}`] = { name: `Transport ${playhead.name}: ${name}` }
		}
	}

	for (const cue of self.state.cues) {
		definitions[`cue_${cue.varId}_note`] = { name: `Cue ${cue.id}: note` }
		definitions[`cue_${cue.varId}_time`] = { name: `Cue ${cue.id}: time in track (s)` }
		definitions[`cue_${cue.varId}_track`] = { name: `Cue ${cue.id}: track` }
		definitions[`cue_${cue.varId}_label`] = { name: `Cue ${cue.id}: button text (note and CUE ${cue.id})` }
	}

	self.setVariableDefinitions(definitions)
	sentValues.delete(self)
}

export function UpdateVariableValues(self: ModuleInstance): void {
	const s = self.state
	const lastCue = s.cues.find((c) => c.id === s.lastCue)
	const trackCues = s.tracks.find((t) => t.uid === s.trackUid)?.cues ?? []
	const values: CompanionVariableValues = {
		connected: s.connected,
		project: s.project,
		version: s.version,
		current_transport: s.currentTransport,
		transport: s.transport,
		playmode: s.playmode,
		playing: s.playing,
		engaged: s.engaged,
		track: s.trackName,
		track_uid: s.trackUid,
		cue_count: trackCues.length,
		cue_list: trackCues.map((c) => c.id).join(', '),
		cue_count_total: s.cues.length,
		track_count: s.tracks.length,
		cue_list_updated: s.cueListUpdated,
		last_cue: s.lastCue,
		last_cue_note: lastCue?.note ?? '',
		...playheadValues(self),
	}

	for (const cue of s.cues) {
		values[`cue_${cue.varId}_note`] = cue.note
		values[`cue_${cue.varId}_time`] = Math.round(cue.time * 1000) / 1000
		values[`cue_${cue.varId}_track`] = cue.trackName
		values[`cue_${cue.varId}_label`] = cue.note ? `${cue.note}\nCUE ${cue.id}` : `CUE ${cue.id}`
	}

	sendChanged(self, values)
}

/**
 * Ready-made text of the status / GO / BACK buttons: "CUE <n>" and its note, or NO CUE.
 * The simple presets (Bitfocus Buttons) show these labels, as a plain template leaves a stray
 * newline when the note is empty and Buttons does not evaluate text expressions.
 */
function statusLabel(cue: Cue | undefined): string {
	if (!cue) return 'NO CUE'
	return cue.note ? `CUE ${cue.id}\n${cue.note}` : `CUE ${cue.id}`
}

/** Only the playhead variables - called on Live Update playhead changes */
export function UpdatePlayheadVariableValues(self: ModuleInstance): void {
	sendChanged(self, playheadValues(self))
}

function playheadValues(self: ModuleInstance): CompanionVariableValues {
	const values: CompanionVariableValues = {}
	for (const p of self.state.playheads) {
		values[`tr_${p.varId}_track`] = p.trackName
		values[`tr_${p.varId}_cue`] = p.cue?.id ?? ''
		values[`tr_${p.varId}_cue_note`] = p.cue?.note ?? ''
		values[`tr_${p.varId}_next_cue`] = p.nextCue?.id ?? ''
		values[`tr_${p.varId}_next_cue_note`] = p.nextCue?.note ?? ''
		values[`tr_${p.varId}_prev_cue`] = p.prevCue?.id ?? ''
		values[`tr_${p.varId}_prev_cue_note`] = p.prevCue?.note ?? ''
		values[`tr_${p.varId}_cue_label`] = statusLabel(p.cue)
		values[`tr_${p.varId}_next_cue_label`] = statusLabel(p.nextCue)
		values[`tr_${p.varId}_prev_cue_label`] = statusLabel(p.prevCue)
		values[`tr_${p.varId}_time`] = formatTimecode(p.time, p.fps)
		values[`tr_${p.varId}_time_to_next`] = p.nextCue ? formatTimecode(p.nextCue.time - p.time, p.fps) : ''
		values[`tr_${p.varId}_playmode`] = self.playmodeOf(p.name)
		values[`tr_${p.varId}_playmode_short`] = PLAYMODE_SHORT[self.playmodeOf(p.name)]
		values[`tr_${p.varId}_playing`] = p.playing
		values[`tr_${p.varId}_engaged`] = p.engaged
	}
	// The main transport: selected in Designer when in use, else the first in use
	const first: TransportPlayhead | undefined =
		self.state.playheads.find((p) => p.name === self.state.transport) ?? self.state.playheads[0]
	values.current_cue = first?.cue?.id ?? ''
	values.current_cue_note = first?.cue?.note ?? ''
	values.next_cue = first?.nextCue?.id ?? ''
	values.next_cue_note = first?.nextCue?.note ?? ''
	values.prev_cue = first?.prevCue?.id ?? ''
	values.prev_cue_note = first?.prevCue?.note ?? ''
	values.current_cue_label = statusLabel(first?.cue)
	values.next_cue_label = statusLabel(first?.nextCue)
	values.prev_cue_label = statusLabel(first?.prevCue)
	values.current_time = first ? formatTimecode(first.time, first.fps) : ''
	return values
}

/** Seconds -> HH:MM:SS:FF at the project refresh rate */
export function formatTimecode(seconds: number, fps: number): string {
	const rate = fps > 0 ? Math.round(fps) : 25
	const totalFrames = Math.max(0, Math.floor(seconds * rate + 1e-6))
	const frames = totalFrames % rate
	const totalSeconds = Math.floor(totalFrames / rate)
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`
}

/** Send only values that changed since the last call */
function sendChanged(self: ModuleInstance, values: CompanionVariableValues): void {
	const sent = sentValues.get(self) ?? {}
	const changed: CompanionVariableValues = {}
	let hasChanges = false
	for (const [id, value] of Object.entries(values)) {
		if (sent[id] !== value) {
			changed[id] = value
			sent[id] = value
			hasChanges = true
		}
	}
	sentValues.set(self, sent)
	if (hasChanges) self.setVariableValues(changed)
}

const sentValues = new WeakMap<ModuleInstance, CompanionVariableValues>()
