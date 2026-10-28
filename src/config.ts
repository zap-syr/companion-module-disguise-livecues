import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	pollInterval: number
	timeout: number
	cueAutoUpdate: boolean
	cueUpdateInterval: number
}

export const DEFAULT_POLL_INTERVAL = 1000
export const DEFAULT_TIMEOUT = 2000
export const DEFAULT_CUE_UPDATE_INTERVAL = 3000

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			width: 12,
			id: 'info',
			label: 'Information',
			value:
				'Connects to the Disguise Designer Session REST API and Live Update (director machine). Cues and notes of all tracks are read automatically and turned into presets, one group per track.',
		},
		{
			type: 'textinput',
			id: 'host',
			width: 8,
			label: 'Designer IP / hostname',
			default: '127.0.0.1',
			minLength: 1,
		},
		{
			type: 'number',
			id: 'port',
			width: 4,
			label: 'HTTP port',
			default: 80,
			min: 1,
			max: 65535,
		},
		{
			type: 'number',
			id: 'pollInterval',
			width: 6,
			label: 'Polling interval (ms) - transport status and reconnect',
			tooltip:
				'How often the transport status (playmode, current track) is read, and the retry interval while Designer is unreachable. The cue list has its own interval below.',
			default: DEFAULT_POLL_INTERVAL,
			min: 250,
			max: 60000,
		},
		{
			type: 'number',
			id: 'timeout',
			width: 6,
			label: 'Request timeout (ms)',
			default: DEFAULT_TIMEOUT,
			min: 200,
			max: 30000,
		},
		{
			type: 'checkbox',
			id: 'cueAutoUpdate',
			width: 6,
			label: 'Automatic cue list updates (Live Update)',
			tooltip:
				'Cues and notes of all tracks are pushed by Designer when they change. Turn off for large projects to avoid any continuous load on Designer: the cue list is then read on connect and by the "Refresh cue list" action only.',
			default: true,
		},
		{
			type: 'number',
			id: 'cueUpdateInterval',
			width: 6,
			label: 'Cue list update interval (ms)',
			tooltip:
				'How often Designer re-evaluates the cue list. Each evaluation costs ~10 ms of Designer main thread per 100 tracks - larger values mean less load.',
			default: DEFAULT_CUE_UPDATE_INTERVAL,
			min: 1000,
			max: 10000,
			isVisibleExpression: '$(options:cueAutoUpdate)',
		},
	]
}
