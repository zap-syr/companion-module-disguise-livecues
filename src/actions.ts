import type { CompanionActionDefinitions, DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { TRANSPORT_AUTO, TRANSPORT_CURRENT, type ModuleSchema } from './main.js'

type PlaymodeOption = 'NotSet' | 'Play' | 'PlaySection' | 'Loop' | 'Stop'

export type ActionsSchema = {
	go_to_cue: { options: { cue: string; transport: string; playmode: PlaymodeOption; global: boolean } }
	go_to_section: { options: { section: number; transport: string; playmode: PlaymodeOption } }
	next_section: { options: { transport: string; playmode: PlaymodeOption } }
	prev_section: { options: { transport: string; playmode: PlaymodeOption } }
	go_to_track: { options: { track: string; transport: string; playmode: PlaymodeOption } }
	next_track: { options: { transport: string; playmode: PlaymodeOption } }
	prev_track: { options: { transport: string; playmode: PlaymodeOption } }
	go_to_timecode: { options: { timecode: string; ignoreTags: boolean; transport: string; playmode: PlaymodeOption } }
	play: { options: { transport: string } }
	play_section: { options: { transport: string } }
	loop_section: { options: { transport: string } }
	stop: { options: { transport: string } }
	return_to_start: { options: { transport: string } }
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
	const transportNames: DropdownChoice[] = self.state.transports.map((t) => ({ id: t.name, label: t.name }))

	const currentTransportChoices: DropdownChoice[] = [
		{ id: TRANSPORT_CURRENT, label: 'Current (selected in Designer)' },
		...transportNames,
	]

	/** Transport for the transport commands: Designer's current one (default) or a name */
	const transportOption = {
		id: 'transport',
		type: 'dropdown',
		label: 'Transport',
		tooltip:
			'Current = the transport selected in Designer (with a multi-transport: the one whose timeline is selected)',
		choices: currentTransportChoices,
		default: TRANSPORT_CURRENT,
		allowCustom: true,
	} as const
	const locator = (option: string | undefined) => self.transportLocator(option)

	const actions: CompanionActionDefinitions<ModuleSchema['actions']> = {
		go_to_cue: {
			name: 'Go to cue',
			description:
				'Jump to a CUE tag (e.g. 1, 2.5, 1.2.3). A cue on another track switches the transport to that track.',
			options: [
				{ id: 'cue', type: 'textinput', label: 'Cue', default: '1', minLength: 1 },
				{
					id: 'transport',
					type: 'dropdown',
					label: 'Transport',
					tooltip:
						'Auto: the selected transport if it is on the cue track, else another transport on that track, else the selected transport switches to the cue track',
					choices: [{ id: TRANSPORT_AUTO, label: 'Auto' }, ...transportNames],
					default: TRANSPORT_AUTO,
					allowCustom: true,
				},
				playmodeOption('PlaySection'),
				{
					id: 'global',
					type: 'checkbox',
					label: 'Always search all tracks (global jump)',
					tooltip: 'Not needed for cues the module knows - their track is switched to automatically',
					default: false,
				},
			],
			callback: async (event) => {
				const cue = String(event.options.cue).trim()
				await run(async () =>
					self.triggerCue(cue, event.options.playmode, event.options.transport, event.options.global),
				)
				self.setLastCue(cue)
			},
		},
		go_to_section: {
			name: 'Go to section',
			description: 'Jump to a section index of the current track (0 = first section)',
			options: [
				{ id: 'section', type: 'number', label: 'Section index', default: 0, min: 0, max: 100000, asInteger: true },
				transportOption,
				playmodeOption(),
			],
			callback: async (event) => {
				await run(async () =>
					self.getApi().goToSection(event.options.section, event.options.playmode, locator(event.options.transport)),
				)
			},
		},
		next_section: {
			name: 'Next section',
			options: [transportOption, playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToNextSection(event.options.playmode, locator(event.options.transport)))
			},
		},
		prev_section: {
			name: 'Previous section',
			options: [transportOption, playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToPrevSection(event.options.playmode, locator(event.options.transport)))
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
				transportOption,
				playmodeOption(),
			],
			callback: async (event) => {
				const name = String(event.options.track).trim()
				await run(async () =>
					self.getApi().goToTrack({ name }, event.options.playmode, locator(event.options.transport)),
				)
			},
		},
		next_track: {
			name: 'Next track',
			options: [transportOption, playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToNextTrack(event.options.playmode, locator(event.options.transport)))
			},
		},
		prev_track: {
			name: 'Previous track',
			options: [transportOption, playmodeOption()],
			callback: async (event) => {
				await run(async () => self.getApi().goToPrevTrack(event.options.playmode, locator(event.options.transport)))
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
				transportOption,
				playmodeOption(),
			],
			callback: async (event) => {
				const timecode = String(event.options.timecode).trim()
				await run(async () =>
					self
						.getApi()
						.goToTimecode(timecode, event.options.ignoreTags, event.options.playmode, locator(event.options.transport)),
				)
			},
		},
		play: {
			name: 'Play',
			options: [transportOption],
			callback: async (event) => run(async () => self.getApi().play(locator(event.options.transport))),
		},
		play_section: {
			name: 'Play to end of section',
			options: [transportOption],
			callback: async (event) => run(async () => self.getApi().playSection(locator(event.options.transport))),
		},
		loop_section: {
			name: 'Loop section',
			options: [transportOption],
			callback: async (event) => run(async () => self.getApi().playLoopSection(locator(event.options.transport))),
		},
		stop: {
			name: 'Stop',
			options: [transportOption],
			callback: async (event) => run(async () => self.getApi().stop(locator(event.options.transport))),
		},
		return_to_start: {
			name: 'Return to start',
			options: [transportOption],
			callback: async (event) => run(async () => self.getApi().returnToStart(locator(event.options.transport))),
		},
		refresh: {
			name: 'Refresh cue list',
			description:
				'Read the cues and notes of all tracks from Designer now (one request). Needed when automatic cue list updates are off.',
			options: [],
			callback: async () => {
				self.pollNow()
				await self.refreshCueList()
			},
		},
	}

	self.setActionDefinitions(actions)
}
