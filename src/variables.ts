import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import type ModuleInstance from './main.js'

// Cue variables (cue_<id>_note, cue_<id>_time, cue_<id>_track) are created dynamically for every cue of the project
export type VariablesSchema = CompanionVariableValues

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		connected: { name: 'Connected to Designer (true/false)' },
		project: { name: 'Project path' },
		version: { name: 'Designer version' },
		transport: { name: 'Active transport name' },
		playmode: { name: 'Playmode of the active transport (Play, PlaySection, Loop, Stop)' },
		engaged: { name: 'Active transport engaged (true/false)' },
		track: { name: 'Current track name' },
		track_uid: { name: 'Current track uid' },
		cue_count: { name: 'Number of cues on the current track' },
		cue_list: { name: 'Cues on the current track (comma separated)' },
		cue_count_total: { name: 'Number of cues in the project (all tracks)' },
		track_count: { name: 'Number of tracks in the project' },
		cue_list_updated: { name: 'Time of the last cue list update' },
		last_cue: { name: 'Last cue triggered from Companion' },
		last_cue_note: { name: 'Note of the last cue triggered from Companion' },
	}

	for (const cue of self.state.cues) {
		definitions[`cue_${cue.varId}_note`] = { name: `Cue ${cue.id}: note` }
		definitions[`cue_${cue.varId}_time`] = { name: `Cue ${cue.id}: time in track (s)` }
		definitions[`cue_${cue.varId}_track`] = { name: `Cue ${cue.id}: track` }
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
		transport: s.transport,
		playmode: s.playmode,
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
	}

	for (const cue of s.cues) {
		values[`cue_${cue.varId}_note`] = cue.note
		values[`cue_${cue.varId}_time`] = Math.round(cue.time * 1000) / 1000
		values[`cue_${cue.varId}_track`] = cue.trackName
	}

	// Only send what changed - this runs on every poll
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
