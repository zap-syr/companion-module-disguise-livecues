import type { CompanionActionDefinitions, DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

type PlaymodeOption = 'NotSet' | 'Play' | 'PlaySection' | 'Loop' | 'Stop'

export type ActionsSchema = {
	go_to_cue: { options: { cue: string; playmode: PlaymodeOption; global: boolean } }
	go_to_section: { options: { section: number; playmode: PlaymodeOption } }
	next_section: { options: { playmode: PlaymodeOption } }
	prev_section: { options: { playmode: PlaymodeOption } }
	go_to_track: { options: { track: string; playmode: PlaymodeOption } }
	next_track: { options: { playmode: PlaymodeOption } }
	prev_track: { options: { playmode: PlaymodeOption } }
	go_to_timecode: { options: { timecode: string; ignoreTags: boolean; playmode: PlaymodeOption } }
	play: { options: Record<string, never> }
	play_section: { options: Record<string, never> }
	loop_section: { options: Record<string, never> }
	stop: { options: Record<string, never> }
	return_to_start: { options: Record<string, never> }
	refresh: { options: Record<string, never> }
}

export const PLAYMODE_CHOICES: DropdownChoice<PlaymodeOption>[] = [
	{ id: 'NotSet', label: "Don't change" },
	{ id: 'Play', label: 'Play' },
	{ id: 'PlaySection', label: 'Play to end of section' },
	{ id: 'Loop', label: 'Loop section' },
	{ id: 'Stop', label: 'Stop (hold)' },
]

const playmodeOption = (def: PlaymodeOption = 'NotSet') =>
	({
		id: 'playmode',
		type: 'dropdown',
		label: 'Playmode after jump',
		choices: PLAYMODE_CHOICES,
		default: def,
	}) as const

export function UpdateActions(self: ModuleInstance): void {
	// Run a command and poll right after, so playmode / feedbacks follow quickly
	const run = async (fn: () => Promise<void>): Promise<void> => {
		try {
			await fn()
		} finally {
			self.pollNow()
		}
	}

	const trackChoices: DropdownChoice[] = self.state.tracks.map((t) => ({ id: t.name, label: t.name }))

	const actions: CompanionActionDefinitions<ModuleSchema['actions']> = {
		go_to_cue: {
			name: 'Go to cue',
			description: 'Jump to a CUE tag of the current track (e.g. 1, 2.5, 1.2.3)',
			options: [
				{ id: 'cue', type: 'textinput', label: 'Cue', default: '1', minLength: 1 },
				playmodeOption('Play'),
				{
					id: 'global',
					type: 'checkbox',
					label: 'Search all tracks (global jump)',
					default: false,
				},
			],
			callback: async (event) => {
				const cue = String(event.options.cue).trim()
				await run(async () => self.getApi().goToCue(cue, event.options.playmode, event.options.global))
				self.setLastCue(cue)
			},
		},
		go_to_section: {
			name: 'Go to section',
			description: 'Jump to a section index of the current track (0 = first section)',
			options: [
				{ id: 'section', type: 'number', label: 'Section index', default: 0, min: 0, max: 100000, asInteger: true },
				playmodeOption(),
			],
			callback: async (event) => {
				await run(async () => self.getApi().goToSection(event.options.section, event.options.playmode))
			},
		},
		next_section: {
			name: 'Next section',
			options: [playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToNextSection(event.options.playmode))
			},
		},
		prev_section: {
			name: 'Previous section',
			options: [playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToPrevSection(event.options.playmode))
			},
		},
		go_to_track: {
			name: 'Go to track',
			options: [
				{
					id: 'track',
					type: 'dropdown',
					label: 'Track (name)',
					choices: trackChoices,
					default: trackChoices[0]?.id ?? '',
					allowCustom: true,
				},
				playmodeOption(),
			],
			callback: async (event) => {
				const name = String(event.options.track).trim()
				await run(async () => self.getApi().goToTrack({ name }, event.options.playmode))
			},
		},
		next_track: {
			name: 'Next track',
			options: [playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToNextTrack(event.options.playmode))
			},
		},
		prev_track: {
			name: 'Previous track',
			options: [playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToPrevTrack(event.options.playmode))
			},
		},
		go_to_timecode: {
			name: 'Go to timecode',
			options: [
				{
					id: 'timecode',
					type: 'textinput',
					label: 'Timecode (HH:MM:SS:FF)',
					default: '00:00:00:00',
					regex: '/^\\d{1,2}:\\d{2}:\\d{2}[:.]\\d{2}$/',
				},
				{
					id: 'ignoreTags',
					type: 'checkbox',
					label: 'Ignore TC tags (time relative to track start)',
					default: true,
				},
				playmodeOption(),
			],
			callback: async (event) => {
				const timecode = String(event.options.timecode).trim()
				await run(async () => self.getApi().goToTimecode(timecode, event.options.ignoreTags, event.options.playmode))
			},
		},
		play: {
			name: 'Play',
			options: [],
			callback: async () => run(async () => self.getApi().play()),
		},
		play_section: {
			name: 'Play to end of section',
			options: [],
			callback: async () => run(async () => self.getApi().playSection()),
		},
		loop_section: {
			name: 'Loop section',
			options: [],
			callback: async () => run(async () => self.getApi().playLoopSection()),
		},
		stop: {
			name: 'Stop',
			options: [],
			callback: async () => run(async () => self.getApi().stop()),
		},
		return_to_start: {
			name: 'Return to start',
			options: [],
			callback: async () => run(async () => self.getApi().returnToStart()),
		},
		refresh: {
			name: 'Refresh cue list',
			description: 'Re-read status and cues from Designer now (they are also polled automatically)',
			options: [],
			callback: async () => self.pollNow(),
		},
	}

	self.setActionDefinitions(actions)
}
