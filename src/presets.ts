import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import {
	TRANSPORT_AUTO,
	TRANSPORT_CURRENT,
	transportVarId,
	type Cue,
	type TrackCues,
	type TransportPlaymode,
} from './main.js'
import { ANY_TRANSPORT, CUE_CURRENT_COLOR, CUE_NEXT_COLOR } from './feedbacks.js'
import { TRANSPORT_ICONS } from './icons.js'
import {
	ButtonGraphicsDecorationType,
	type ButtonGraphicsCanvasElement,
	type ButtonGraphicsTextElement,
	type CompanionButtonStepActions,
	type CompanionPresetDefinitions,
	type CompanionPresetGroup,
	type CompanionPresetSection,
	type SomeButtonGraphicsElement,
} from '@companion-module/base'

const WHITE = 0xffffff
const BLACK = 0x000000
const GREEN = 0x00a000
const RED = 0xa00000
const GREY = 0x303030

/** Share of the button height used by the note; the cue number takes the rest */
const NOTE_HEIGHT = 65
/** Height of the transport name strip on the top of cue buttons bound to a transport */
const TRANSPORT_LABEL_HEIGHT = 18
const LABEL_GREY = 0xbbbbbb
/** Status buttons without the top bar / border, so the text gets the whole button */
const STATUS_CANVAS: ButtonGraphicsCanvasElement = { decoration: ButtonGraphicsDecorationType.None }

type PresetDefinition = CompanionPresetDefinitions<ModuleSchema>[string]

/**
 * Cue button: "CUE <n>" alone when the cue has no note, otherwise the note on the top 65 %
 * and the cue number on the bottom 35 %. Both layouts are on the button and switched by the
 * note variable, so a placed button follows a note added or removed later in Designer.
 * A simple preset is kept as a fallback for hosts without layered buttons (Bitfocus Buttons).
 *
 * Without `transport` the button uses Auto and lights from any transport; with it the button
 * is bound to that transport (and shows its name small in the top right corner).
 */
function cuePreset(label: string, cue: Cue, transport?: string): PresetDefinition {
	const name = (cue.note ? `Cue ${cue.id} - ${cue.note}` : `Cue ${cue.id}`) + (transport ? ` (${transport})` : '')
	// The note comes from a variable, so placed buttons follow note edits in Designer
	const noteText = `$(${label}:cue_${cue.varId}_note)`
	const cueText = `CUE ${cue.id}`
	const hasNote = { isExpression: true, value: `${noteText} != ''` } as const
	const noNote = { isExpression: true, value: `${noteText} == ''` } as const
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
			fontsize: 100,
			fontsizeAllowShrink: true,
			color: LABEL_GREY,
			halign: 'right',
			valign: 'top',
		})
	}
	elements.push(
		{
			type: 'text',
			id: 'note',
			name: 'Note',
			enabled: hasNote,
			x: 0,
			y: top,
			width: 100,
			height: NOTE_HEIGHT - top,
			text: noteText,
			fontsize: 60,
			fontsizeAllowShrink: true,
			color: WHITE,
			halign: 'center',
			valign: 'center',
		},
		{
			type: 'text',
			id: 'cue',
			name: 'Cue number (with note)',
			enabled: hasNote,
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
		{
			type: 'text',
			id: 'cue_only',
			name: 'Cue number (no note)',
			enabled: noNote,
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
		},
	)

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
					// The module builds the text (note and cue number) in a variable, so a note added later shows
					// up and an empty note leaves no stray newline (Buttons shows it as a literal "\n")
					text: (transport ? `${transport}\n` : '') + `$(${label}:cue_${cue.varId}_label)`,
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

/** Bottom of the cue number on the status buttons when a note is shown below it */
const STATUS_CUE_BOTTOM = 50
/** Top of the small grey detail line on the bottom of the status buttons */
const STATUS_DETAIL_TOP = 65

/** Centered white text element of the status buttons */
function textElement(
	id: string,
	name: string,
	y: number,
	height: number,
	text: string,
	fontsize: number,
	extra: Partial<ButtonGraphicsTextElement> = {},
): ButtonGraphicsTextElement {
	return {
		type: 'text',
		id,
		name,
		x: 0,
		y,
		width: 100,
		height,
		text,
		fontsize,
		fontsizeAllowShrink: true,
		color: WHITE,
		halign: 'center',
		valign: 'center',
		...extra,
	}
}

/** Background and the small grey header on the top left of the status buttons */
function statusBase(header: string, color = GREY): SomeButtonGraphicsElement[] {
	return [
		{ type: 'box', id: 'bg', name: 'Background', x: 0, y: 0, width: 100, height: 100, color },
		textElement('header', 'Header', 0, TRANSPORT_LABEL_HEIGHT, header, 100, {
			x: 4,
			width: 96,
			color: LABEL_GREY,
			halign: 'left',
			valign: 'top',
		}),
	]
}

/**
 * Status button with a header, a large value and a small grey detail line below it
 * (layered, without decoration), plus a simple fallback for Bitfocus Buttons.
 */
function statusPreset(
	name: string,
	header: string,
	value: string,
	detail: string,
	steps: CompanionButtonStepActions<ModuleSchema>[],
): PresetDefinition {
	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name,
				canvas: STATUS_CANVAS,
				elements: [
					...statusBase(header),
					textElement('value', 'Value', TRANSPORT_LABEL_HEIGHT, STATUS_DETAIL_TOP - TRANSPORT_LABEL_HEIGHT, value, 50),
					textElement('detail', 'Detail', STATUS_DETAIL_TOP, 100 - STATUS_DETAIL_TOP, detail, 50, {
						color: LABEL_GREY,
					}),
				],
				steps,
				feedbacks: [],
			},
			{
				type: 'simple',
				name,
				style: { text: `${header}\n${value}\n${detail}`, size: 'auto', color: WHITE, bgcolor: GREY },
				steps,
				feedbacks: [],
			},
		],
	}
}

/**
 * Background per playmode, in feedback order: later feedbacks win, so the hold states come after
 * PlaySection (whose feedback stays true while holding at the section end)
 */
const PLAYMODE_COLORS: [Exclude<TransportPlaymode, ''>, number][] = [
	['Play', GREEN],
	['PlaySection', 0x0050a0],
	['Loop', 0x7000a0],
	['Stop', RED],
	['HoldSection', 0xa07800],
	['HoldEnd', 0xa07800],
]
/** Most transports shown on one "all transports" playmode button */
const MODES_PER_BUTTON = 4

/** Feedbacks coloring the element `elementId` by the playmode of `transport` */
function playmodeColorFeedbacks(elementId: string, transport: string) {
	return PLAYMODE_COLORS.map(([playmode, color]) => ({
		feedbackId: 'playmode' as const,
		options: { playmode, transport },
		styleOverrides: [{ elementId, elementProperty: 'color', override: { isExpression: false as const, value: color } }],
	}))
}

/** Playmode of one transport: its name as header, the short playmode large, background by playmode */
function playmodePreset(label: string, transport: string): PresetDefinition {
	const name = `Playmode of transport ${transport}`
	const mode = `$(${label}:tr_${transportVarId(transport)}_playmode_short)`
	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name,
				canvas: STATUS_CANVAS,
				elements: [
					...statusBase(transport),
					textElement('mode', 'Playmode', TRANSPORT_LABEL_HEIGHT, 100 - TRANSPORT_LABEL_HEIGHT, mode, 50),
				],
				steps: [],
				feedbacks: playmodeColorFeedbacks('bg', transport),
			},
			{
				type: 'simple',
				name,
				style: { text: `${transport}\n${mode}`, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [],
				feedbacks: PLAYMODE_COLORS.map(([playmode, color]) => ({
					feedbackId: 'playmode' as const,
					options: { playmode, transport },
					style: { bgcolor: color, color: WHITE },
				})),
			},
		],
	}
}

/** Playmode of several transports: one row each (name left, short playmode right), row colored by playmode */
function playmodesPreset(label: string, transports: string[], header: string): PresetDefinition {
	const name = `Playmodes: ${transports.join(', ')}`
	const rowHeight = (100 - TRANSPORT_LABEL_HEIGHT) / transports.length
	const elements: SomeButtonGraphicsElement[] = [...statusBase(header)]
	transports.forEach((transport, i) => {
		const y = TRANSPORT_LABEL_HEIGHT + i * rowHeight
		const mode = `$(${label}:tr_${transportVarId(transport)}_playmode_short)`
		elements.push(
			{
				type: 'box',
				id: `row${i}`,
				name: `Row ${transport}`,
				x: 0,
				y: y + 1,
				width: 100,
				height: rowHeight - 2,
				color: GREY,
			},
			textElement(`name${i}`, `Name ${transport}`, y, rowHeight, transport, 60, { x: 4, width: 46, halign: 'left' }),
			textElement(`mode${i}`, `Playmode ${transport}`, y, rowHeight, mode, 60, { x: 50, width: 46, halign: 'right' }),
		)
	})
	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name,
				canvas: STATUS_CANVAS,
				elements,
				steps: [],
				feedbacks: transports.flatMap((transport, i) => playmodeColorFeedbacks(`row${i}`, transport)),
			},
			{
				type: 'simple',
				name,
				style: {
					text: transports
						.map((transport) => `${transport}: $(${label}:tr_${transportVarId(transport)}_playmode_short)`)
						.join('\n'),
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
				},
				steps: [],
				feedbacks: [],
			},
		],
	}
}

/** Top of the cue number on the GO / BACK buttons; the GO / BACK label is above it */
const GO_CUE_TOP = 45
/** Top of the note on the GO / BACK buttons */
const GO_NOTE_TOP = 70
const GO_GREEN = 0x004d00
/** Light orange - the cue number on the GO / BACK buttons */
const GO_CUE_COLOR = 0xffc080

/**
 * GO / BACK button of a transport ("current" or a name): the label large, below it the cue it jumps
 * to and its note, or NO CUE when there is none
 */
function goPreset(label: string, direction: 'next' | 'prev', transport: string): PresetDefinition {
	const isGo = direction === 'next'
	const title = isGo ? 'GO' : 'BACK'
	const varPrefix = transport === TRANSPORT_CURRENT ? '' : `tr_${transportVarId(transport)}_`
	const cueVar = `$(${label}:${varPrefix}${direction}_cue)`
	const noteVar = `$(${label}:${varPrefix}${direction}_cue_note)`
	const name =
		(isGo ? 'GO - next cue' : 'BACK - previous cue') + (transport === TRANSPORT_CURRENT ? '' : ` (${transport})`)
	const bgcolor = isGo ? GO_GREEN : GREY
	const expr = (value: string) => ({ isExpression: true, value }) as const
	const steps: CompanionButtonStepActions<ModuleSchema>[] = [
		{
			down: [{ actionId: isGo ? 'go_next_cue' : 'go_prev_cue', options: { transport, playmode: 'PlaySection' } }],
			up: [],
		},
	]

	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name,
				elements: [
					{ type: 'box', id: 'bg', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: bgcolor },
					textElement('title', 'GO / BACK', 0, GO_CUE_TOP, title, 70),
					textElement('cue', 'Cue number', GO_CUE_TOP, GO_NOTE_TOP - GO_CUE_TOP, `CUE ${cueVar}`, 100, {
						color: GO_CUE_COLOR,
						enabled: expr(`${cueVar} != ''`),
					}),
					textElement('note', 'Note', GO_NOTE_TOP, 100 - GO_NOTE_TOP, noteVar, 80, {
						color: LABEL_GREY,
						enabled: expr(`${noteVar} != ''`),
					}),
					textElement('no_cue', 'No cue', GO_CUE_TOP, 100 - GO_CUE_TOP, 'NO CUE', 50, {
						enabled: expr(`${cueVar} == ''`),
					}),
				],
				steps,
				feedbacks: [],
			},
			{
				type: 'simple',
				name,
				style: {
					text: `${title}\n$(${label}:${varPrefix}${direction}_cue_label)`,
					size: 'auto',
					color: WHITE,
					bgcolor,
				},
				steps,
				feedbacks: [],
			},
		],
	}
}

/** GO and BACK presets of a transport, added to `presets`; returns their ids */
function addGoButtons(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	label: string,
	idPrefix: string,
	transport: string,
): string[] {
	presets[`${idPrefix}_go`] = goPreset(label, 'next', transport)
	presets[`${idPrefix}_back`] = goPreset(label, 'prev', transport)
	return [`${idPrefix}_go`, `${idPrefix}_back`]
}

/** Engage toggle of a transport ("current" or a name): red DISENGAGED, green ENGAGED; returns its id */
function addEngageButton(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	idPrefix: string,
	transport: string,
): string {
	const id = `${idPrefix}_engaged`
	presets[id] = {
		type: 'simple',
		name: 'Engage / disengage' + (transport === TRANSPORT_CURRENT ? '' : ` (${transport})`),
		style: { text: 'DISENGAGED', size: '14', color: WHITE, bgcolor: RED },
		steps: [{ down: [{ actionId: 'set_engaged', options: { mode: 'toggle', transport } }], up: [] }],
		feedbacks: [{ feedbackId: 'engaged', options: { transport }, style: { text: 'ENGAGED', bgcolor: GREEN } }],
	}
	return id
}

/** Top of the cue count on the track buttons */
const TRACK_COUNT_TOP = 70

/**
 * Track button: jumps a transport ("current" or a name) to the track, keeping its playmode.
 * Shows the track name and its cue count, lit while the transport is on the track.
 */
function trackPreset(track: TrackCues, transport: string): PresetDefinition {
	const isCurrent = transport === TRANSPORT_CURRENT
	const name = `Track ${track.name}` + (isCurrent ? '' : ` (${transport})`)
	const count = `${track.cues.length} CUE${track.cues.length === 1 ? '' : 'S'}`
	// Leave room for the transport name above the track name
	const top = isCurrent ? 0 : TRANSPORT_LABEL_HEIGHT
	const steps: CompanionButtonStepActions<ModuleSchema>[] = [
		{
			down: [{ actionId: 'go_to_track', options: { track: track.name, transport, playmode: 'NotSet' } }],
			up: [],
		},
	]
	const feedbackOptions = { track: track.name, transport }

	const elements: SomeButtonGraphicsElement[] = [
		{ type: 'box', id: 'bg', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: BLACK },
		textElement('track', 'Track name', top, TRACK_COUNT_TOP - top, track.name, 60),
		textElement('count', 'Cue count', TRACK_COUNT_TOP, 100 - TRACK_COUNT_TOP, count, 50, { color: LABEL_GREY }),
	]
	if (!isCurrent) {
		elements.push(
			textElement('transport', 'Transport', 0, TRANSPORT_LABEL_HEIGHT, transport, 100, {
				width: 96,
				color: LABEL_GREY,
				halign: 'right',
				valign: 'top',
			}),
		)
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
						feedbackId: 'track_active',
						options: feedbackOptions,
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
					text: (isCurrent ? '' : `${transport}\n`) + `${track.name}\n${count}`,
					size: 'auto',
					color: WHITE,
					bgcolor: BLACK,
				},
				steps,
				feedbacks: [
					{ feedbackId: 'track_active', options: feedbackOptions, style: { bgcolor: CUE_CURRENT_COLOR, color: WHITE } },
				],
			},
		],
	}
}

/**
 * Track buttons: one group for the transport selected in Designer (every track of the project) and,
 * with a multi-transport, one group per transport (the tracks of its setlist)
 */
function trackGroups(presets: CompanionPresetDefinitions<ModuleSchema>, self: ModuleInstance): CompanionPresetGroup[] {
	const { tracks, transports } = self.state
	const group = (id: string, name: string, description: string, list: TrackCues[], transport: string) => {
		const ids = list.map((track) => {
			const presetId = `${id}_${track.uid}`
			presets[presetId] = trackPreset(track, transport)
			return presetId
		})
		return { id, name, description, type: 'simple' as const, presets: ids }
	}

	const groups: CompanionPresetGroup[] = [
		group(
			'tracks_current',
			'Selected transport',
			'Jump the transport selected in Designer to a track (keeps its playmode)',
			tracks,
			TRANSPORT_CURRENT,
		),
	]
	if (self.config.cuePresetsPerTransport !== false && transports.length > 1) {
		for (const transport of transports) {
			const setlist = (transport.setList?.tracks ?? [])
				.map((t) => tracks.find((track) => track.uid === t.uid))
				.filter((t): t is TrackCues => !!t)
			if (setlist.length === 0) continue
			groups.push(
				group(
					`tracks_tr_${transportVarId(transport.name)}`,
					transport.name,
					`Jump transport "${transport.name}" to a track of its setlist`,
					setlist,
					transport.name,
				),
			)
		}
	}
	return groups
}

/** Connection status: "DISGUISE" header and OFFLINE on red, ONLINE on green while connected */
function connectionPreset(steps: CompanionButtonStepActions<ModuleSchema>[]): PresetDefinition {
	const name = 'Connection status'
	return {
		type: 'alternatives',
		variants: [
			{
				type: 'layered',
				name,
				canvas: STATUS_CANVAS,
				elements: [
					...statusBase('DISGUISE', RED),
					textElement('state', 'State', TRANSPORT_LABEL_HEIGHT, 100 - TRANSPORT_LABEL_HEIGHT, 'OFFLINE', 50),
				],
				steps,
				feedbacks: [
					{
						feedbackId: 'connected',
						options: {},
						styleOverrides: [
							{ elementId: 'bg', elementProperty: 'color', override: { isExpression: false, value: GREEN } },
							{ elementId: 'state', elementProperty: 'text', override: { isExpression: false, value: 'ONLINE' } },
						],
					},
				],
			},
			{
				type: 'simple',
				name,
				style: { text: 'DISGUISE\nOFFLINE', size: 'auto', color: WHITE, bgcolor: RED },
				steps,
				feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: GREEN, text: 'DISGUISE\nONLINE' } }],
			},
		],
	}
}

/**
 * Status button of the current ("now") or next cue of the selected transport: a small header,
 * "CUE <n>" and its note. Expressions switch the layout when the cue has no note, and show NO CUE
 * when there is no cue.
 */
function statusCuePreset(label: string, kind: 'now' | 'next'): PresetDefinition {
	const prefix = kind === 'now' ? 'current' : 'next'
	const header = kind === 'now' ? 'NOW' : 'NEXT'
	const name = kind === 'now' ? 'Current cue (playhead of the selected transport)' : 'Next cue (selected transport)'
	const cueVar = `$(${label}:${prefix}_cue)`
	const noteVar = `$(${label}:${prefix}_cue_note)`
	const cueText = `CUE ${cueVar}`
	const top = TRANSPORT_LABEL_HEIGHT

	const expr = (value: string) => ({ isExpression: true, value }) as const
	const hasCue = `${cueVar} != ''`
	const hasNote = `${noteVar} != ''`

	const elements: SomeButtonGraphicsElement[] = [
		...statusBase(header),
		textElement('cue', 'Cue number (with note)', top, STATUS_CUE_BOTTOM - top, cueText, 50, {
			enabled: expr(`${hasCue} && ${hasNote}`),
		}),
		textElement('note', 'Note', STATUS_CUE_BOTTOM, 100 - STATUS_CUE_BOTTOM, noteVar, 60, { enabled: expr(hasNote) }),
		textElement('cue_only', 'Cue number (no note)', top, 100 - top, cueText, 50, {
			enabled: expr(`${hasCue} && ${noteVar} == ''`),
		}),
		textElement('no_cue', 'No cue', top, 100 - top, 'NO CUE', 50, { enabled: expr(`${cueVar} == ''`) }),
	]

	return {
		type: 'alternatives',
		variants: [
			{ type: 'layered', name, canvas: STATUS_CANVAS, elements, steps: [], feedbacks: [] },
			{
				type: 'simple',
				name,
				style: {
					text: `${header}\n$(${label}:${prefix}_cue_label)`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
				},
				steps: [],
				feedbacks: [],
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
			presets: [
				...addGoButtons(presets, label, 'transport', TRANSPORT_CURRENT),
				...addTransportButtons('transport', TRANSPORT_CURRENT, ''),
				addEngageButton(presets, 'transport', TRANSPORT_CURRENT),
			],
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
			presets: [
				`${prefix}_status`,
				...addGoButtons(presets, label, prefix, transport.name),
				...ids,
				addEngageButton(presets, prefix, transport.name),
			],
		})
	}

	// Playmodes of all transports on one button - multi-transport only, a few transports per button
	const playmodeIds: string[] = []
	const transportNames = self.state.transports.map((t) => t.name)
	if (transportNames.length > 1) {
		for (let start = 0; start < transportNames.length; start += MODES_PER_BUTTON) {
			const chunk = transportNames.slice(start, start + MODES_PER_BUTTON)
			const header = transportNames.length > MODES_PER_BUTTON ? `MODES ${start + 1}-${start + chunk.length}` : 'MODES'
			const id = `status_playmodes_${start / MODES_PER_BUTTON}`
			presets[id] = playmodesPreset(label, chunk, header)
			playmodeIds.push(id)
		}
	}
	// And one playmode button per transport, next to the status buttons
	const transportPlaymodeIds = self.state.transports.map((transport) => {
		const id = `status_playmode_${transportVarId(transport.name)}`
		presets[id] = playmodePreset(label, transport.name)
		return id
	})

	// --- Status ---
	const refreshSteps: CompanionButtonStepActions<ModuleSchema>[] = [
		{ down: [{ actionId: 'refresh', options: {} }], up: [] },
	]
	presets['status_track'] = statusPreset(
		'Current track and playmode',
		'TRACK',
		`$(${label}:track)`,
		`$(${label}:playmode)`,
		refreshSteps,
	)
	presets['status_connection'] = connectionPreset(refreshSteps)
	presets['status_current_cue'] = statusCuePreset(label, 'now')
	presets['status_next_cue'] = statusCuePreset(label, 'next')
	presets['status_refresh'] = statusPreset(
		'Refresh cue list',
		'CUE LIST',
		'REFRESH',
		`$(${label}:cue_list_updated)`,
		refreshSteps,
	)

	const structure: CompanionPresetSection[] = [
		{
			id: 'cues',
			// Named like the per-transport sections: these cue buttons use the Auto transport
			name: 'Cues - Auto',
			definitions: cueGroups,
		},
		...transportCueSections,
		{
			id: 'tracks',
			name: 'Tracks',
			definitions: trackGroups(presets, self),
		},
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
					presets: [
						'status_connection',
						'status_track',
						'status_current_cue',
						'status_next_cue',
						'status_refresh',
						...playmodeIds,
					],
				},
				{
					id: 'status_playmode_buttons',
					name: 'Playmode per transport',
					description: 'One button per transport in use, colored by its playmode',
					type: 'simple',
					presets: transportPlaymodeIds,
				},
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
