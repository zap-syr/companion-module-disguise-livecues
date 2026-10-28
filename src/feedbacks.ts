import type { CompanionFeedbackDefinitions, DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema, TransportPlayhead } from './main.js'

export const ANY_TRANSPORT = 'any'
/** Dark green - the cue under the playhead */
export const CUE_CURRENT_COLOR = 0x006600
/** Dark yellow - the cue after the playhead */
export const CUE_NEXT_COLOR = 0x663300

export type FeedbacksSchema = {
	connected: {
		type: 'boolean'
		options: Record<string, never>
	}
	playmode: {
		type: 'boolean'
		options: {
			playmode: 'Play' | 'PlaySection' | 'Loop' | 'Stop'
		}
	}
	cue_active: {
		type: 'boolean'
		options: {
			cue: string
			transport: string
		}
	}
	cue_next: {
		type: 'boolean'
		options: {
			cue: string
			transport: string
		}
	}
	cue_last_triggered: {
		type: 'boolean'
		options: {
			cue: string
		}
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const transportChoices: DropdownChoice[] = [
		{ id: ANY_TRANSPORT, label: 'Any transport' },
		...self.state.transports.map((t) => ({ id: t.name, label: t.name })),
	]
	const transportOption = {
		id: 'transport',
		type: 'dropdown',
		label: 'Transport',
		choices: transportChoices,
		default: ANY_TRANSPORT,
		allowCustom: true,
	} as const

	/** Playheads of the selected transport (or all of them); options from older buttons may lack it */
	const playheadsFor = (transport: string | undefined): TransportPlayhead[] => {
		const name = String(transport ?? ANY_TRANSPORT).trim()
		return name === '' || name === ANY_TRANSPORT
			? self.state.playheads
			: self.state.playheads.filter((p) => p.name === name)
	}

	const feedbacks: CompanionFeedbackDefinitions<ModuleSchema['feedbacks']> = {
		connected: {
			name: 'Connected to Designer',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00a000,
				color: 0xffffff,
			},
			options: [],
			callback: () => self.state.connected,
		},
		playmode: {
			name: 'Playmode of the active transport',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00a000,
				color: 0xffffff,
			},
			options: [
				{
					id: 'playmode',
					type: 'dropdown',
					label: 'Playmode',
					choices: [
						{ id: 'Play', label: 'Play' },
						{ id: 'PlaySection', label: 'Play to end of section' },
						{ id: 'Loop', label: 'Loop section' },
						{ id: 'Stop', label: 'Stop' },
					],
					default: 'Play',
					disableAutoExpression: true,
				},
			],
			callback: (feedback) => self.state.connected && self.state.playmode === feedback.options.playmode,
		},
		cue_active: {
			name: 'Cue is current (playhead)',
			description:
				'True while the playhead of a transport is between this cue and the next one - also for cues started in Designer or by timecode',
			type: 'boolean',
			defaultStyle: {
				bgcolor: CUE_CURRENT_COLOR,
				color: 0xffffff,
			},
			options: [{ id: 'cue', type: 'textinput', label: 'Cue', default: '1' }, transportOption],
			callback: (feedback) => {
				const cue = String(feedback.options.cue).trim()
				return playheadsFor(feedback.options.transport).some((p) => p.cue?.id === cue)
			},
		},
		cue_next: {
			name: 'Cue is next (playhead)',
			description: 'True when this cue is the next one after the playhead of a transport',
			type: 'boolean',
			defaultStyle: {
				bgcolor: CUE_NEXT_COLOR,
				color: 0xffffff,
			},
			options: [{ id: 'cue', type: 'textinput', label: 'Cue', default: '1' }, transportOption],
			callback: (feedback) => {
				const cue = String(feedback.options.cue).trim()
				return playheadsFor(feedback.options.transport).some((p) => p.nextCue?.id === cue)
			},
		},
		cue_last_triggered: {
			name: 'Cue is the last triggered from Companion',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xc08000,
				color: 0xffffff,
			},
			options: [{ id: 'cue', type: 'textinput', label: 'Cue', default: '1' }],
			callback: (feedback) => self.state.lastCue !== '' && self.state.lastCue === String(feedback.options.cue).trim(),
		},
	}

	self.setFeedbackDefinitions(feedbacks)
}
