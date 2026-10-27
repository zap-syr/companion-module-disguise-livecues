import type { CompanionFeedbackDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

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
		}
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
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
			name: 'Cue is the last triggered cue',
			description: 'True when this cue was the last one triggered from Companion',
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
