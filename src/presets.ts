import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import { TRANSPORT_AUTO, TRANSPORT_CURRENT, transportVarId, type Cue } from './main.js'
import { ANY_TRANSPORT, CUE_CURRENT_COLOR, CUE_NEXT_COLOR } from './feedbacks.js'
import { TRANSPORT_ICONS } from './icons.js'
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
/** Height of the transport name strip on the top of cue buttons bound to a transport */
const TRANSPORT_LABEL_HEIGHT = 14
const LABEL_GREY = 0xbbbbbb

type PresetDefinition = CompanionPresetDefinitions<ModuleSchema>[string]

/**
 * Cue button: "CUE <n>" alone when the cue has no note, otherwise the note on the top 65 %
 * and the cue number on the bottom 35 %. A simple preset is kept as a fallback for hosts
 * without layered buttons (Bitfocus Buttons).
 *
 * Without `transport` the button uses Auto and lights from any transport; with it the button
 * is bound to that transport (and shows its name small in the top right corner).
 */
function cuePreset(label: string, cue: Cue, transport?: string): PresetDefinition {
	const name = (cue.note ? `Cue ${cue.id} - ${cue.note}` : `Cue ${cue.id}`) + (transport ? ` (${transport})` : '')
	// The note comes from a variable, so placed buttons follow note edits in Designer
	const noteText = `$(${label}:cue_${cue.varId}_note)`
	const cueText = `CUE ${cue.id}`
	const feedbackTransport = transport ?? ANY_TRANSPORT
	// Leave room for the transport name above the note / cue number
	const top = transport ? TRANSPORT_LABEL_HEIGHT : 0

	const steps: CompanionButtonStepActions<ModuleSchema>[] = [
		{
			down: [
				{
					actionId: 'go_to_cue',
					options: { cue: cue.id, transport: transport ?? TRANSPORT_AUTO, playmode: 'PlaySection', global: false },
				},
			],
			up: [],
		},
	]

	const elements: SomeButtonGraphicsElement[] = [
		{ type: 'box', id: 'bg', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: BLACK },
	]
	if (transport) {
		elements.push({
			type: 'text',
			id: 'transport',
			name: 'Transport',
			x: 0,
			y: 0,
			width: 96,
			height: TRANSPORT_LABEL_HEIGHT,
			text: transport,
			fontsize: 90,
			fontsizeAllowShrink: true,
			color: LABEL_GREY,
			halign: 'right',
			valign: 'top',
		})
	}
	if (cue.note) {
		elements.push(
			{
				type: 'text',
				id: 'note',
				name: 'Note',
				x: 0,
				y: top,
				width: 100,
				height: NOTE_HEIGHT - top,
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
			y: top,
			width: 100,
			height: 100 - top,
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
						options: { cue: cue.id, transport: feedbackTransport },
						styleOverrides: [
							{ elementId: 'bg', elementProperty: 'color', override: { isExpression: false, value: CUE_NEXT_COLOR } },
						],
					},
					{
						feedbackId: 'cue_active',
						options: { cue: cue.id, transport: feedbackTransport },
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
					text: (transport ? `${transport}\n` : '') + (cue.note ? `${noteText}\n${cueText}` : cueText),
					size: 'auto',
					color: WHITE,
					bgcolor: BLACK,
				},
				steps,
				feedbacks: [
					{
						feedbackId: 'cue_next',
						options: { cue: cue.id, transport: feedbackTransport },
						style: { bgcolor: CUE_NEXT_COLOR, color: WHITE },
					},
					{
						feedbackId: 'cue_active',
						options: { cue: cue.id, transport: feedbackTransport },
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
	// --- Cues per transport: only with a multi-transport (more than one transport in use) ---
	const transportCueSections: CompanionPresetSection[] = []
	if (self.config.cuePresetsPerTransport !== false && self.state.transports.length > 1) {
		for (const transport of self.state.transports) {
			const varId = transportVarId(transport.name)
			const groups: CompanionPresetGroup[] = []
			// Tracks of this transport's setlist, in setlist order - other tracks can not be reached from it
			for (const setlistTrack of transport.setList?.tracks ?? []) {
				const track = tracks.find((t) => t.uid === setlistTrack.uid)
				if (!track || track.cues.length === 0) continue
				const presetIds: string[] = []
				for (const cue of track.cues) {
					const id = `cue_tr_${varId}_${cue.varId}`
					presetIds.push(id)
					presets[id] = cuePreset(label, cue, transport.name)
				}
				groups.push({
					id: `cues_tr_${varId}_track_${track.uid}`,
					name: track.name,
					description: `${track.cues.length} cue(s) - always triggered on transport "${transport.name}"`,
					type: 'simple',
					presets: presetIds,
				})
			}
			if (groups.length === 0) continue
			transportCueSections.push({ id: `cues_tr_${varId}`, name: `Cues - ${transport.name}`, definitions: groups })
		}
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
	// Icons are PNGs (as in the Designer transport bar): the button fonts of Companion and Buttons
	// lack most media control glyphs
	const transportButtons: [
		keyof typeof TRANSPORT_ICONS,
		string,
		string,
		keyof ModuleSchema['actions'],
		('Play' | 'PlaySection' | 'Loop' | 'Stop')?,
	][] = [
		['play', 'Play', 'PLAY', 'set_playmode', 'Play'],
		['play_section', 'Play section', 'SECTION', 'set_playmode', 'PlaySection'],
		['loop_section', 'Loop section', 'LOOP', 'set_playmode', 'Loop'],
		['stop', 'Stop', 'STOP', 'set_playmode', 'Stop'],
		['return_to_start', 'Return to start', 'START', 'return_to_start'],
		['prev_section', 'Previous section', 'SECTION', 'prev_section'],
		['next_section', 'Next section', 'SECTION', 'next_section'],
		['prev_track', 'Previous track', 'TRACK', 'prev_track'],
		['next_track', 'Next track', 'TRACK', 'next_track'],
	]
	/** Transport buttons bound to `transport` ("current" or a transport name); returns their preset ids */
	const addTransportButtons = (idPrefix: string, transport: string, nameSuffix: string): string[] => {
		const ids: string[] = []
		for (const [id, name, text, actionId, playmode] of transportButtons) {
			const presetId = `${idPrefix}_${id}`
			ids.push(presetId)
			presets[presetId] = {
				type: 'simple',
				name: name + nameSuffix,
				style: {
					text,
					size: '14',
					alignment: 'center:bottom',
					png64: TRANSPORT_ICONS[id],
					pngalignment: 'center:top',
					color: WHITE,
					bgcolor: BLACK,
				},
				steps: [
					{
						down: [
							{
								actionId,
								options: playmode
									? { playmode, transport }
									: actionId.includes('_section') || actionId.includes('_track')
										? { transport, playmode: 'NotSet' }
										: { transport },
							},
						],
						up: [],
					},
				],
				feedbacks: playmode
					? [
							{
								feedbackId: 'playmode',
								options: { playmode, transport },
								style: { bgcolor: playmode === 'Stop' ? RED : GREEN, color: WHITE },
							},
						]
					: [],
			} as PresetDefinition
		}
		return ids
	}

	const transportGroups: CompanionPresetGroup[] = [
		{
			id: 'transport_buttons',
			name: 'Transport (selected in Designer)',
			description: 'Act on the transport selected in Designer (multi-transport: the selected timeline)',
			type: 'simple',
			presets: addTransportButtons('transport', TRANSPORT_CURRENT, ''),
		},
	]

	// One group per transport in use (a multi-transport has several), with its own status button
	for (const transport of self.state.transports) {
		const varId = transportVarId(transport.name)
		const prefix = `transport_tr_${varId}`
		const ids = addTransportButtons(prefix, transport.name, ` (${transport.name})`)
		presets[`${prefix}_status`] = {
			type: 'simple',
			name: `Status of transport ${transport.name}`,
			style: {
				text: `${transport.name}: $(${label}:tr_${varId}_track)\nCUE $(${label}:tr_${varId}_cue)\n$(${label}:tr_${varId}_time)`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'playing',
					options: { transport: transport.name },
					style: { bgcolor: GREEN, color: WHITE },
				},
			],
		}
		transportGroups.push({
			id: `transport_tr_${varId}`,
			name: `Transport - ${transport.name}`,
			description: `Act on transport "${transport.name}"`,
			type: 'simple',
			presets: [`${prefix}_status`, ...ids],
		})
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

	presets['status_current_cue'] = {
		type: 'simple',
		name: 'Current cue (playhead of the selected transport)',
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
		name: 'Next cue (selected transport)',
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
		...transportCueSections,
		{
			id: 'transport',
			name: 'Transport',
			definitions: transportGroups,
		},
		{
			id: 'status',
			name: 'Status',
			definitions: [
				{
					id: 'status_buttons',
					name: 'Status',
					type: 'simple',
					presets: ['status_connection', 'status_track', 'status_current_cue', 'status_next_cue', 'status_refresh'],
				},
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
