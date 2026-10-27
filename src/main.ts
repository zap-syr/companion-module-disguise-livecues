import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { DEFAULT_POLL_INTERVAL, DEFAULT_TIMEOUT, GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import {
	DisguiseApi,
	DisguiseConnectionError,
	DisguiseNoProjectError,
	type CueInfo,
	type PlayMode,
	type TrackInfo,
} from './disguise.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

/** A cue tag on the active track */
export interface Cue {
	/** Cue tag value as entered in Designer, e.g. "1", "2.5", "1.2.3" */
	id: string
	/** Cue id usable inside variable ids ("1.2" -> "1_2") */
	varId: string
	note: string
	/** Seconds from the start of the track */
	time: number
}

export interface DisguiseState {
	connected: boolean
	project: string
	version: string
	transport: string
	playmode: PlayMode | ''
	engaged: boolean
	trackName: string
	trackUid: string
	tracks: TrackInfo[]
	cues: Cue[]
	lastCue: string
}

const MAX_RETRY_DELAY = 5000

function emptyState(): DisguiseState {
	return {
		connected: false,
		project: '',
		version: '',
		transport: '',
		playmode: '',
		engaged: false,
		trackName: '',
		trackUid: '',
		tracks: [],
		cues: [],
		lastCue: '',
	}
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	state: DisguiseState = emptyState()

	private api: DisguiseApi | null = null
	private pollTimer: NodeJS.Timeout | null = null
	private polling = false
	private pollAgain = false
	private failCount = 0
	private lastStatus = ''
	/** Signature of the cue list the presets were built from */
	private cueSignature = ''
	/** Signature of the cue ids the variable definitions were built from */
	private variableSignature = ''
	private tracksSignature = ''

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config

		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updatePresets()

		this.start()
	}

	// When module gets deleted
	async destroy(): Promise<void> {
		this.stop()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.stop()
		this.state = emptyState()
		this.cueSignature = ''
		this.variableSignature = ''
		this.tracksSignature = ''
		// The label may have changed - presets reference variables through it
		this.updateActions()
		this.updateVariableDefinitions()
		this.updatePresets()
		this.start()
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
		UpdateVariableValues(this)
	}

	/** API client of the current connection; throws when not configured */
	getApi(): DisguiseApi {
		if (!this.api) throw new Error('Disguise connection is not configured')
		return this.api
	}

	// --- Connection handling ---

	private start(): void {
		const host = (this.config.host ?? '').trim()
		if (!host) {
			this.setStatus(InstanceStatus.BadConfig, 'Designer IP / hostname is not set')
			return
		}
		this.api = new DisguiseApi(host, this.config.port || 80, this.config.timeout || DEFAULT_TIMEOUT)
		this.failCount = 0
		this.setStatus(InstanceStatus.Connecting)
		this.log('info', `Connecting to Disguise Designer at ${this.api.baseUrl}`)
		void this.poll()
	}

	private stop(): void {
		this.api = null
		if (this.pollTimer) clearTimeout(this.pollTimer)
		this.pollTimer = null
		this.pollAgain = false
		this.lastStatus = ''
	}

	/** Poll as soon as possible (after a command or on request) */
	pollNow(): void {
		if (!this.api) return
		if (this.polling) {
			this.pollAgain = true
			return
		}
		if (this.pollTimer) clearTimeout(this.pollTimer)
		this.pollTimer = null
		void this.poll()
	}

	private get pollInterval(): number {
		return Math.max(250, this.config.pollInterval || DEFAULT_POLL_INTERVAL)
	}

	private async poll(): Promise<void> {
		const api = this.api
		if (!api || this.polling) return
		this.polling = true
		this.pollAgain = false

		try {
			await this.refresh(api)
			if (api !== this.api) return
			if (this.failCount > 0) this.log('info', 'Connection to Disguise Designer restored')
			this.failCount = 0
			this.setStatus(InstanceStatus.Ok)
		} catch (e) {
			if (api !== this.api) return
			this.handlePollError(e as Error)
		} finally {
			this.polling = false
			if (api === this.api) {
				let delay = this.pollInterval
				if (this.pollAgain) delay = 0
				else if (this.failCount > 0) delay = Math.min(delay * this.failCount, Math.max(delay, MAX_RETRY_DELAY))
				this.pollTimer = setTimeout(() => {
					this.pollTimer = null
					void this.poll()
				}, delay)
			}
		}
	}

	private async refresh(api: DisguiseApi): Promise<void> {
		const wasConnected = this.state.connected

		// Project info and track list only change with a project (re)load or edit - read them on (re)connect
		if (!wasConnected) {
			const project = await api.getProject()
			const v = project.version
			this.state.project = project.projectPath
			this.state.version = `r${v.major}.${v.minor}.${v.hotfix}.${v.revision}`
			this.state.tracks = await api.getTracks()
		}

		const transports = await api.getActiveTransport()
		const transport = transports[0]
		const trackUid = transport?.currentTrack?.uid ?? ''
		const cues = await api.getCues(trackUid || undefined)
		if (api !== this.api) return

		this.state.connected = true
		this.state.transport = transport?.name ?? ''
		this.state.playmode = transport?.playmode ?? ''
		this.state.engaged = transport?.engaged ?? false
		this.state.trackUid = trackUid
		this.state.trackName = transport?.currentTrack?.name ?? ''
		if (trackUid && !this.state.tracks.some((t) => t.uid === trackUid)) {
			// Track created after we connected - refresh the list
			this.state.tracks = await api.getTracks()
		}
		this.state.cues = parseCues(cues)

		this.applyState(!wasConnected)
	}

	private handlePollError(err: Error): void {
		this.failCount++
		const wasConnected = this.state.connected
		this.state.connected = false
		this.state.playmode = ''

		if (err instanceof DisguiseNoProjectError) {
			this.setStatus(InstanceStatus.UnknownWarning, 'Designer is reachable but no project is running')
		} else if (err instanceof DisguiseConnectionError) {
			this.setStatus(wasConnected ? InstanceStatus.Disconnected : InstanceStatus.ConnectionFailure, err.message)
		} else {
			this.setStatus(InstanceStatus.UnknownError, err.message)
		}

		if (wasConnected) {
			this.log('warn', `Lost connection to Disguise Designer: ${err.message}. Retrying...`)
			this.applyState(false)
		}
	}

	/** Only send a status when it changes, so the log is not flooded while retrying */
	private setStatus(status: InstanceStatus, message?: string): void {
		const key = `${status}|${message ?? ''}`
		if (key === this.lastStatus) return
		this.lastStatus = key
		this.updateStatus(status, message ?? null)
	}

	/** Push the state to variables, feedbacks and - when the cue list changed - presets */
	private applyState(reconnected: boolean): void {
		const cueSignature = JSON.stringify([this.state.trackUid, this.state.cues.map((c) => [c.id, c.note])])
		const variableSignature = JSON.stringify(this.state.cues.map((c) => c.varId))
		const tracksSignature = JSON.stringify(this.state.tracks.map((t) => [t.uid, t.name]))

		if (variableSignature !== this.variableSignature) {
			this.variableSignature = variableSignature
			UpdateVariableDefinitions(this)
		}
		UpdateVariableValues(this)

		if (tracksSignature !== this.tracksSignature) {
			this.tracksSignature = tracksSignature
			this.updateActions() // the track dropdown lists the project tracks
		}

		if (cueSignature !== this.cueSignature) {
			if (this.cueSignature !== '' || reconnected) {
				this.log(
					'info',
					`Cue list of "${this.state.trackName}" updated: ${this.state.cues.length} cue(s) - presets rebuilt`,
				)
			}
			this.cueSignature = cueSignature
			this.updatePresets()
		}

		this.checkFeedbacks('connected', 'playmode', 'cue_active')
	}

	/** Remember the cue triggered from Companion (until the playhead is tracked via Live Update) */
	setLastCue(cue: string): void {
		this.state.lastCue = cue
		UpdateVariableValues(this)
		this.checkFeedbacks('cue_active')
	}
}

/** Flatten the REST cue list to the CUE tags it contains (with the note of their section) */
export function parseCues(cues: CueInfo[]): Cue[] {
	const result: Cue[] = []
	const seen = new Set<string>()
	for (const cue of cues) {
		for (const tag of cue.tags ?? []) {
			if (tag.type !== 'CUE' || !tag.value || seen.has(tag.value)) continue
			seen.add(tag.value)
			result.push({
				id: tag.value,
				varId: tag.value.replace(/[^A-Za-z0-9]/g, '_'),
				note: cue.note?.text ?? '',
				time: tag.time,
			})
		}
	}
	return result
}
