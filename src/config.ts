import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	pollInterval: number
	timeout: number
}

export const DEFAULT_POLL_INTERVAL = 1000
export const DEFAULT_TIMEOUT = 2000

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			width: 12,
			id: 'info',
			label: 'Information',
			value:
				'Connects to the Disguise Designer Session REST API (director machine). Cues of the active track are read automatically and turned into presets.',
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
			label: 'Polling interval (ms) - status, cue list and reconnect',
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
	]
}
