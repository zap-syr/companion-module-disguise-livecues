import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

const WHITE = 0xffffff
const BLACK = 0x000000
const GREEN = 0x00a000
const ORANGE = 0xc08000
const RED = 0xa00000
const GREY = 0x303030

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const label = self.label
	const { cues, trackName } = self.state

	// --- Cues of the current track (rebuilt automatically when the cue list changes) ---
	const cuePresetIds: string[] = []
	for (const cue of cues) {
		const id = `cue_${cue.varId}`
		cuePresetIds.push(id)
		presets[id] = {
			type: 'simple',
			name: cue.note ? `Cue ${cue.id} - ${cue.note}` : `Cue ${cue.id}`,
			style: {
				// The note comes from a variable, so placed buttons follow note edits in Designer
				text: `CUE ${cue.id}\
$(${label}:cue_${cue.varId}_note)`,
				size: 'auto',
				color: WHITE,
				bgcolor: BLACK,
			},
			steps: [
				{
					down: [{ actionId: 'go_to_cue', options: { cue: cue.id, playmode: 'Play', global: false } }],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'cue_active',
					options: { cue: cue.id },
					style: { bgcolor: ORANGE, color: WHITE },
				},
			],
		}
	}

	// --- Transport ---
	const transportButtons: [
		string,
		string,
		keyof ModuleSchema['actions'],
		('Play' | 'PlaySection' | 'Loop' | 'Stop')?,
	][] = [
		[
			'play',
			'⏵\
PLAY',
			'play',
			'Play',
		],
		[
			'play_section',
			'⏵|\
SECTION',
			'play_section',
			'PlaySection',
		],
		[
			'loop_section',
			'⟳\
LOOP',
			'loop_section',
			'Loop',
		],
		[
			'stop',
			'⏸\
STOP',
			'stop',
			'Stop',
		],
		[
			'return_to_start',
			'⏮\
START',
			'return_to_start',
		],
		[
			'prev_section',
			'◀\
SECTION',
			'prev_section',
		],
		[
			'next_section',
			'SECTION\
▶',
			'next_section',
		],
		[
			'prev_track',
			'◀\
TRACK',
			'prev_track',
		],
		[
			'next_track',
			'TRACK\
▶',
			'next_track',
		],
	]
	const transportPresetIds: string[] = []
	for (const [id, text, actionId, playmode] of transportButtons) {
		const presetId = `transport_${id}`
		transportPresetIds.push(presetId)
		presets[presetId] = {
			type: 'simple',
			name: text.replace(
				'\
',
				' ',
			),
			style: { text, size: 'auto', color: WHITE, bgcolor: BLACK },
			steps: [
				{
					down: [
						{
							actionId,
							options: actionId.includes('_section') || actionId.includes('_track') ? { playmode: 'NotSet' } : {},
						},
					],
					up: [],
				},
			],
			feedbacks: playmode
				? [
						{
							feedbackId: 'playmode',
							options: { playmode },
							style: { bgcolor: playmode === 'Stop' ? RED : GREEN, color: WHITE },
						},
					]
				: [],
		} as CompanionPresetDefinitions<ModuleSchema>[string]
	}

	// --- Status ---
	presets['status_track'] = {
		type: 'simple',
		name: 'Current track and playmode',
		style: {
			text: `$(${label}:track)\
$(${label}:playmode)`,
			size: 'auto',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [],
	}
	presets['status_connection'] = {
		type: 'simple',
		name: 'Connection status',
		style: {
			text: 'DISGUISE\
OFFLINE',
			size: 'auto',
			color: WHITE,
			bgcolor: RED,
		},
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [
			{
				feedbackId: 'connected',
				options: {},
				style: {
					bgcolor: GREEN,
					text: 'DISGUISE\
ONLINE',
				},
			},
		],
	}
	presets['status_last_cue'] = {
		type: 'simple',
		name: 'Last cue triggered',
		style: {
			text: `CUE $(${label}:last_cue)\
$(${label}:last_cue_note)`,
			size: 'auto',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [],
		feedbacks: [],
	}

	const structure: CompanionPresetSection[] = [
		{
			id: 'cues',
			name: 'Cues',
			definitions: [
				{
					id: 'cues_current_track',
					name: trackName ? `Cues - ${trackName}` : 'Cues',
					description: cues.length
						? 'Generated automatically from the CUE tags and notes of the active track'
						: 'No CUE tags found on the active track (or not connected yet)',
					type: 'simple',
					presets: cuePresetIds,
				},
			],
		},
		{
			id: 'transport',
			name: 'Transport',
			definitions: [
				{
					id: 'transport_buttons',
					name: 'Transport',
					type: 'simple',
					presets: transportPresetIds,
				},
			],
		},
		{
			id: 'status',
			name: 'Status',
			definitions: [
				{
					id: 'status_buttons',
					name: 'Status',
					type: 'simple',
					presets: ['status_connection', 'status_track', 'status_last_cue'],
				},
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
