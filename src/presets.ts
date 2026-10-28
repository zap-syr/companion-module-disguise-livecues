import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { Cue } from './main.js'
import type {
	CompanionButtonStepActions,
	CompanionPresetDefinitions,
	CompanionPresetSection,
	SomeButtonGraphicsElement,
} from '@companion-module/base'

const WHITE = 0xffffff
const BLACK = 0x000000
const GREEN = 0x00a000
const ORANGE = 0xc08000
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
				feedbacks: [
					{
						feedbackId: 'cue_active',
						options: { cue: cue.id },
						styleOverrides: [
							{ elementId: 'bg', elementProperty: 'color', override: { isExpression: false, value: ORANGE } },
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
				feedbacks: [{ feedbackId: 'cue_active', options: { cue: cue.id }, style: { bgcolor: ORANGE, color: WHITE } }],
			},
		],
	}
}

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const label = self.label
	const { cues, trackName } = self.state

	// --- Cues of the current track (rebuilt automatically when the cue list changes) ---
	const cuePresetIds: string[] = []
	for (const cue of cues) {
		const id = `cue_${cue.varId}`
		cuePresetIds.push(id)
		presets[id] = cuePreset(label, cue)
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
