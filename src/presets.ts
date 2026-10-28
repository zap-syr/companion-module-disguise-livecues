import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { Cue } from './main.js'
import { ANY_TRANSPORT, CUE_CURRENT_COLOR, CUE_NEXT_COLOR } from './feedbacks.js'
import type {
	CompanionButtonStepActions,
	CompanionPresetDefinitions,
	CompanionPresetGroup,
	CompanionPresetSection,
	SomeButtonGraphicsElement,
} from '@companion-module/base'

const WHITE = 0xffffff
const BLACK = 0x000000
const GREEN = 0x00a000
const RED = 0xa00000
const GREY = 0x303030

/** Share of the button height used by the note; the cue number takes the rest */
const NOTE_HEIGHT = 65

type PresetDefinition = CompanionPresetDefinitions<ModuleSchema>[string]

/**
 * Cue button: "CUE <n>" alone when the cue has no note, otherwise the note on the top 65 %
 * and the cue number on the bottom 35 %. A simple preset is kept as a fallback for hosts
 * without layered buttons (Bitfocus Buttons).
 */
function cuePreset(label: string, cue: Cue): PresetDefinition {
	const name = cue.note ? `Cue ${cue.id} - ${cue.note}` : `Cue ${cue.id}`
	// The note comes from a variable, so placed buttons follow note edits in Designer
	const noteText = `$(${label}:cue_${cue.varId}_note)`
	const cueText = `CUE ${cue.id}`

	const steps: CompanionButtonStepActions<ModuleSchema>[] = [
		{
			down: [{ actionId: 'go_to_cue', options: { cue: cue.id, playmode: 'PlaySection', global: false } }],
			up: [],
		},
	]

	const elements: SomeButtonGraphicsElement[] = [
		{ type: 'box', id: 'bg', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: BLACK },
	]
	if (cue.note) {
		elements.push(
			{
				type: 'text',
				id: 'note',
				name: 'Note',
				x: 0,
				y: 0,
				width: 100,
				height: NOTE_HEIGHT,
				text: noteText,
				fontsize: 40,
				fontsizeAllowShrink: true,
				color: WHITE,
				halign: 'center',
				valign: 'center',
			},
			{
				type: 'text',
				id: 'cue',
				name: 'Cue number',
				x: 0,
				y: NOTE_HEIGHT,
				width: 100,
				height: 100 - NOTE_HEIGHT,
				text: cueText,
				fontsize: 50,
				fontsizeAllowShrink: true,
				color: WHITE,
				halign: 'center',
				valign: 'center',
			},
		)
	} else {
		elements.push({
			type: 'text',
			id: 'cue',
			name: 'Cue number',
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			text: cueText,
			fontsize: 40,
			fontsizeAllowShrink: true,
			color: WHITE,
			halign: 'center',
			valign: 'center',
		})
	}

	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name,
				elements,
				steps,
				// Later feedbacks win: "current" is applied after "next" (a cue can be next on one transport
				// and current on another)
				feedbacks: [
					{
						feedbackId: 'cue_next',
						options: { cue: cue.id, transport: ANY_TRANSPORT },
						styleOverrides: [
							{ elementId: 'bg', elementProperty: 'color', override: { isExpression: false, value: CUE_NEXT_COLOR } },
						],
					},
					{
						feedbackId: 'cue_active',
						options: { cue: cue.id, transport: ANY_TRANSPORT },
						styleOverrides: [
							{
								elementId: 'bg',
								elementProperty: 'color',
								override: { isExpression: false, value: CUE_CURRENT_COLOR },
							},
						],
					},
				],
			},
			{
				type: 'simple',
				name,
				style: {
					text: cue.note ? `${noteText}\n${cueText}` : cueText,
					size: 'auto',
					color: WHITE,
					bgcolor: BLACK,
				},
				steps,
				feedbacks: [
					{
						feedbackId: 'cue_next',
						options: { cue: cue.id, transport: ANY_TRANSPORT },
						style: { bgcolor: CUE_NEXT_COLOR, color: WHITE },
					},
					{
						feedbackId: 'cue_active',
						options: { cue: cue.id, transport: ANY_TRANSPORT },
						style: { bgcolor: CUE_CURRENT_COLOR, color: WHITE },
					},
				],
			},
		],
	}
}

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const label = self.label
	const { tracks } = self.state

	// --- Cues of every track, one group per track (rebuilt automatically when the cue list changes) ---
	const cueGroups: CompanionPresetGroup[] = []
	for (const track of tracks) {
		if (track.cues.length === 0) continue
		const presetIds: string[] = []
		for (const cue of track.cues) {
			const id = `cue_${cue.varId}`
			presetIds.push(id)
			presets[id] = cuePreset(label, cue)
		}
		cueGroups.push({
			id: `cues_track_${track.uid}`,
			name: track.name,
			description: `${track.cues.length} cue(s) - generated from the CUE tags and notes of the track`,
			type: 'simple',
			presets: presetIds,
		})
	}
	if (cueGroups.length === 0) {
		cueGroups.push({
			id: 'cues_none',
			name: 'Cues',
			description: 'No CUE tags found in the project (or the cue list was not read yet - see "Refresh cue list")',
			type: 'simple',
			presets: [],
		})
	}

	// --- Transport ---
	const transportButtons: [
		string,
		string,
		keyof ModuleSchema['actions'],
		('Play' | 'PlaySection' | 'Loop' | 'Stop')?,
	][] = [
		['play', '⏵\nPLAY', 'play', 'Play'],
		['play_section', '⏵|\nSECTION', 'play_section', 'PlaySection'],
		['loop_section', '⟳\nLOOP', 'loop_section', 'Loop'],
		['stop', '⏸\nSTOP', 'stop', 'Stop'],
		['return_to_start', '⏮\nSTART', 'return_to_start'],
		['prev_section', '◀\nSECTION', 'prev_section'],
		['next_section', 'SECTION\n▶', 'next_section'],
		['prev_track', '◀\nTRACK', 'prev_track'],
		['next_track', 'TRACK\n▶', 'next_track'],
	]
	const transportPresetIds: string[] = []
	for (const [id, text, actionId, playmode] of transportButtons) {
		const presetId = `transport_${id}`
		transportPresetIds.push(presetId)
		presets[presetId] = {
			type: 'simple',
			name: text.replace('\n', ' '),
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
		} as PresetDefinition
	}

	// --- Status ---
	presets['status_track'] = {
		type: 'simple',
		name: 'Current track and playmode',
		style: {
			text: `$(${label}:track)\n$(${label}:playmode)`,
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
		style: { text: 'DISGUISE\nOFFLINE', size: 'auto', color: WHITE, bgcolor: RED },
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: GREEN, text: 'DISGUISE\nONLINE' } }],
	}
	presets['status_last_cue'] = {
		type: 'simple',
		name: 'Last cue triggered',
		style: {
			text: `CUE $(${label}:last_cue)\n$(${label}:last_cue_note)`,
			size: 'auto',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [],
		feedbacks: [],
	}

	presets['status_current_cue'] = {
		type: 'simple',
		name: 'Current cue (playhead of the first transport in use)',
		style: {
			text: `NOW $(${label}:current_cue)\n$(${label}:current_cue_note)\n$(${label}:current_time)`,
			size: 'auto',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [],
		feedbacks: [],
	}
	presets['status_next_cue'] = {
		type: 'simple',
		name: 'Next cue (first transport in use)',
		style: {
			text: `NEXT $(${label}:next_cue)\n$(${label}:next_cue_note)`,
			size: 'auto',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [],
		feedbacks: [],
	}
	presets['status_refresh'] = {
		type: 'simple',
		name: 'Refresh cue list',
		style: {
			text: `REFRESH CUES\n$(${label}:cue_list_updated)`,
			size: 'auto',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [],
	}

	const structure: CompanionPresetSection[] = [
		{
			id: 'cues',
			name: 'Cues',
			definitions: cueGroups,
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
					presets: [
						'status_connection',
						'status_track',
						'status_current_cue',
						'status_next_cue',
						'status_last_cue',
						'status_refresh',
					],
				},
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
