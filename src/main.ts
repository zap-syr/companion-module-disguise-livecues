import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import {
	DEFAULT_CUE_UPDATE_INTERVAL,
	DEFAULT_POLL_INTERVAL,
	DEFAULT_TIMEOUT,
	GetConfigFields,
	type ModuleConfig,
} from './config.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import {
	CUE_LIST_EXPRESSION,
	DisguiseApi,
	DisguiseCommandError,
	DisguiseConnectionError,
	DisguiseNoProjectError,
	type PlayMode,
	type RawTrackCues,
	type TransportInfo,
} from './disguise.js'
import { LiveUpdateClient, transportObjectPath } from './liveupdate.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

/** A cue tag on a track */
export interface Cue {
	/** Cue tag value as entered in Designer, e.g. "1", "2.5", "1.2.3" - unique per project */
	id: string
	/** Cue id usable inside variable ids ("1.2" -> "1_2") */
	varId: string
	note: string
	/** Seconds from the start of the track */
	time: number
	trackUid: string
	trackName: string
}

export interface TrackCues {
	uid: string
	name: string
	cues: Cue[]
}

export interface DisguiseState {
	connected: boolean
	project: string
	version: string
	/** Transports in use: one, or every child of the selected multi-transport */
	transports: TransportInfo[]
	transport: string
	playmode: PlayMode | ''
	engaged: boolean
	trackName: string
	trackUid: string
	/** Every track of the project with its cues, in preset order */
	tracks: TrackCues[]
	/** All cues of the project, in preset order */
	cues: Cue[]
	/** Local time of the last cue list update */
	cueListUpdated: string
	lastCue: string
}

const MAX_RETRY_DELAY = 5000
const CUE_LIST_SUBSCRIPTION = 'cueList'

function emptyState(): DisguiseState {
	return {
		connected: false,
		project: '',
		version: '',
		transports: [],
		transport: '',
		playmode: '',
		engaged: false,
		trackName: '',
		trackUid: '',
		tracks: [],
		cues: [],
		cueListUpdated: '',
		lastCue: '',
	}
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	state: DisguiseState = emptyState()

	private api: DisguiseApi | null = null
	private liveUpdate: LiveUpdateClient | null = null
	private liveUpdateError = ''
	private pollTimer: NodeJS.Timeout | null = null
	private polling = false
	private pollAgain = false
	private failCount = 0
	private lastStatus = ''
	/** Signature of the cue list the presets were built from */
	private presetSignature = ''
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
		this.presetSignature = ''
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

	private get cueAutoUpdate(): boolean {
		return this.config.cueAutoUpdate !== false
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
		this.closeLiveUpdate()
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
			this.updateConnectionStatus()
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

		// Project info only changes with a project (re)load - read it on (re)connect
		if (!wasConnected) {
			const project = await api.getProject()
			const v = project.version
			this.state.project = project.projectPath
			this.state.version = `r${v.major}.${v.minor}.${v.hotfix}.${v.revision}`
		}

		const transports = await api.getActiveTransport()
		if (api !== this.api) return
		const transport = transports[0]

		this.state.connected = true
		this.state.transports = transports
		this.state.transport = transport?.name ?? ''
		this.state.playmode = transport?.playmode ?? ''
		this.state.engaged = transport?.engaged ?? false
		this.state.trackUid = transport?.currentTrack?.uid ?? ''
		this.state.trackName = transport?.currentTrack?.name ?? ''

		if (this.cueAutoUpdate) {
			this.ensureLiveUpdate(api)
		} else if (!wasConnected) {
			// Manual mode: read the cue list once per connection, then only on "Refresh cue list".
			// Only a lost connection fails the poll; a script error is logged and the list stays empty.
			await this.loadCueList(api).catch((e: Error) => {
				if (e instanceof DisguiseConnectionError || e instanceof DisguiseNoProjectError) throw e
			})
		}

		this.applyState()
	}

	private handlePollError(err: Error): void {
		this.failCount++
		const wasConnected = this.state.connected
		this.state.connected = false
		this.state.playmode = ''
		this.closeLiveUpdate()

		if (err instanceof DisguiseNoProjectError) {
			this.setStatus(InstanceStatus.UnknownWarning, 'Designer is reachable but no project is running')
		} else if (err instanceof DisguiseConnectionError) {
			this.setStatus(wasConnected ? InstanceStatus.Disconnected : InstanceStatus.ConnectionFailure, err.message)
		} else {
			this.setStatus(InstanceStatus.UnknownError, err.message)
		}

		if (wasConnected) {
			this.log('warn', `Lost connection to Disguise Designer: ${err.message}. Retrying...`)
			this.applyState()
		}
	}

	/** Ok, or a warning while REST works but the Live Update socket the module needs does not */
	private updateConnectionStatus(): void {
		if (!this.state.connected) return
		if (this.cueAutoUpdate && this.liveUpdateError) {
			this.setStatus(
				InstanceStatus.UnknownWarning,
				`Live Update ${this.liveUpdateError} - automatic cue list updates paused`,
			)
		} else {
			this.setStatus(InstanceStatus.Ok)
		}
	}

	/** Only send a status when it changes, so the log is not flooded while retrying */
	private setStatus(status: InstanceStatus, message?: string): void {
		const key = `${status}|${message ?? ''}`
		if (key === this.lastStatus) return
		this.lastStatus = key
		this.updateStatus(status, message ?? null)
	}

	// --- Live Update ---

	/** Open the websocket (retried on every poll while closed) and keep the cue list subscription current */
	private ensureLiveUpdate(api: DisguiseApi): void {
		if (!this.liveUpdate) {
			const client = new LiveUpdateClient(api.liveUpdateUrl, {
				onOpen: () => {
					if (this.liveUpdate !== client) return
					if (this.liveUpdateError) this.log('info', 'Live Update connected')
					this.liveUpdateError = ''
					this.updateConnectionStatus()
				},
				onClose: (reason) => {
					if (this.liveUpdate !== client) return
					if (!this.liveUpdateError) this.log('warn', `Live Update ${reason}, retrying`)
					this.liveUpdateError = reason
					this.updateConnectionStatus()
				},
				log: (level, message) => this.log(level, message),
			})
			this.liveUpdate = client
		}
		this.liveUpdate.connect()

		// Any resolvable object will do as the subscription anchor - use the first transport in use
		const anchor = this.state.transports[0]?.name
		if (!anchor) return
		const interval = Math.min(10000, Math.max(1000, this.config.cueUpdateInterval || DEFAULT_CUE_UPDATE_INTERVAL))
		this.liveUpdate.subscribe(
			CUE_LIST_SUBSCRIPTION,
			transportObjectPath(anchor),
			CUE_LIST_EXPRESSION,
			(value) => this.setCueList(value),
			{
				updateFrequencyMs: interval,
				onError: (message) => this.log('warn', `Cue list subscription failed: ${message}`),
			},
		)
	}

	private closeLiveUpdate(): void {
		this.liveUpdate?.destroy()
		this.liveUpdate = null
		this.liveUpdateError = ''
	}

	// --- Cue list ---

	/** Read the cue list of all tracks now (one Python execute) */
	async refreshCueList(): Promise<void> {
		await this.loadCueList(this.getApi())
	}

	private async loadCueList(api: DisguiseApi): Promise<void> {
		try {
			const raw = await api.getAllCues()
			if (api === this.api) this.setCueList(raw)
		} catch (e) {
			this.log('warn', `Reading the cue list failed: ${(e as Error).message}`)
			throw e
		}
	}

	private setCueList(raw: unknown): void {
		if (!Array.isArray(raw)) {
			this.log('warn', 'Unexpected cue list received from Designer')
			return
		}
		const seen = new Map<string, string>()
		const tracks: TrackCues[] = []
		for (const [uid, name, rawCues] of raw as RawTrackCues[]) {
			const track: TrackCues = { uid: String(uid), name: String(name), cues: [] }
			for (const [id, note, time] of rawCues ?? []) {
				const cueId = String(id ?? '').trim()
				if (!cueId) continue
				const other = seen.get(cueId)
				if (other !== undefined) {
					this.log('warn', `Cue ${cueId} exists on "${other}" and "${track.name}" - ignoring the second one`)
					continue
				}
				seen.set(cueId, track.name)
				track.cues.push({
					id: cueId,
					varId: cueId.replace(/[^A-Za-z0-9]/g, '_'),
					note: String(note ?? ''),
					time: Number(time) || 0,
					trackUid: track.uid,
					trackName: track.name,
				})
			}
			tracks.push(track)
		}

		this.state.tracks = tracks
		this.state.cueListUpdated = new Date().toLocaleTimeString('en-GB')
		this.applyState()
	}

	/** Tracks in preset order: setlist of the first transport in use, then the rest by name */
	private orderedTracks(): TrackCues[] {
		const setlist = (this.state.transports[0]?.setList?.tracks ?? []).map((t) => t.uid)
		const rank = (t: TrackCues) => {
			const i = setlist.indexOf(t.uid)
			return i === -1 ? Number.MAX_SAFE_INTEGER : i
		}
		return [...this.state.tracks].sort(
			(a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
		)
	}

	/** Push the state to variables, feedbacks and - when the cue list changed - presets */
	private applyState(): void {
		this.state.tracks = this.orderedTracks()
		this.state.cues = this.state.tracks.flatMap((t) => t.cues)

		const presetSignature = JSON.stringify(
			this.state.tracks.map((t) => [t.uid, t.name, t.cues.map((c) => [c.id, c.note])]),
		)
		const variableSignature = JSON.stringify(this.state.cues.map((c) => c.varId))
		const tracksSignature = JSON.stringify(this.state.tracks.map((t) => t.name))

		if (variableSignature !== this.variableSignature) {
			this.variableSignature = variableSignature
			UpdateVariableDefinitions(this)
		}
		UpdateVariableValues(this)

		if (tracksSignature !== this.tracksSignature) {
			this.tracksSignature = tracksSignature
			this.updateActions() // the track dropdown lists the project tracks
		}

		if (presetSignature !== this.presetSignature) {
			if (this.presetSignature !== '') {
				this.log(
					'info',
					`Cue list updated: ${this.state.cues.length} cue(s) on ${this.state.tracks.length} track(s) - presets rebuilt`,
				)
			}
			this.presetSignature = presetSignature
			this.updatePresets()
		}

		this.checkFeedbacks('connected', 'playmode', 'cue_active')
	}

	/**
	 * Jump to a cue on the first transport in use. A cue on another track is reached with a global jump
	 * (Designer switches the transport to that track, within its setlist).
	 */
	async triggerCue(cueId: string, playmode: PlayMode, forceGlobal: boolean): Promise<void> {
		const api = this.getApi()
		const cue = this.state.cues.find((c) => c.id === cueId)
		const transport = this.state.transports[0]
		const onOtherTrack = !!cue && !!transport && transport.currentTrack?.uid !== cue.trackUid

		if (cue && onOtherTrack && transport.setList && !transport.setList.tracks.some((t) => t.uid === cue.trackUid)) {
			throw new Error(
				`Cue ${cueId} is on track "${cue.trackName}", which is not in the setlist of transport "${transport.name}"`,
			)
		}

		const global = forceGlobal || onOtherTrack
		try {
			// Address the transport explicitly: with a multi-transport an empty locator may pick another one
			await api.goToCue(cueId, playmode, global, transport ? { uid: transport.uid } : undefined)
		} catch (e) {
			// With allowGlobalJump Designer answers "Not every transport has been moved" even after a
			// successful jump - tolerated when the cue is known to exist in the transport's setlist
			const falseWarning =
				global && !!cue && e instanceof DisguiseCommandError && e.message.includes('Not every transport has been moved')
			if (!falseWarning) throw e
		}
	}

	/** Remember the cue triggered from Companion (until the playhead is tracked via Live Update) */
	setLastCue(cue: string): void {
		this.state.lastCue = cue
		UpdateVariableValues(this)
		this.checkFeedbacks('cue_active')
	}
}
