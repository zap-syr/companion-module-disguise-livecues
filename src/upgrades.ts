import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import { DEFAULT_CUE_UPDATE_INTERVAL, type ModuleConfig } from './config.js'

/** v0.2: cue list of all tracks through Live Update - defaults for the new config fields */
const addCueListDefaults: CompanionStaticUpgradeScript<ModuleConfig> = (_context, props) => {
	const config = props.config
	if (!config || (config.cueAutoUpdate !== undefined && config.cueUpdateInterval !== undefined)) {
		return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
	}
	return {
		updatedConfig: {
			...config,
			cueAutoUpdate: config.cueAutoUpdate ?? true,
			cueUpdateInterval: config.cueUpdateInterval ?? DEFAULT_CUE_UPDATE_INTERVAL,
		},
		updatedActions: [],
		updatedFeedbacks: [],
	}
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	/*
	 * Place your upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */
	addCueListDefaults,
]
