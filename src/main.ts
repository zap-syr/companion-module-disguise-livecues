import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import {
	DEFAULT_CUE_UPDATE_INTERVAL,
	DEFAULT_POLL_INTERVAL,
	DEFAULT_TIMEOUT,
	GetConfigFields,
	type ModuleConfig,
} from './config.js'
import {
	UpdatePlayheadVariableValues,
	UpdateVariableDefinitions,
	UpdateVariableValues,
	type VariablesSchema,
} from './variables.js'
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
	type Locator,
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
	/** Sorted by time */
	cues: Cue[]
}

/** Live position of a transport in use, from its Live Update playhead subscription */
export interface TransportPlayhead {
	uid: string
	name: string
	/** Transport name usable inside variable ids */
	varId: string
	trackUid: string
	trackName: string
	/** Seconds from the start of the track */
	time: number
	/** Project refresh rate, used for timecode and the cue time tolerance */
	fps: number
	/** Last cue at or before the playhead */
	cue?: Cue
	nextCue?: Cue
}

export interface DisguiseState {
	connected: boolean
	project: string
	version: string
	/** Transports in use: one, or every child of the selected multi-transport */
	transports: TransportInfo[]
	/** Designer's current transport (multi-transport: the one whose timeline is selected), from Live Update */
	currentTransport: string
	/** Name of the main transport: the current one when known and in use, else the first in use */
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
	/** One entry per transport in use, same order as `transports` */
	playheads: TransportPlayhead[]
	lastCue: string
}

const MAX_RETRY_DELAY = 5000
const CUE_LIST_SUBSCRIPTION = 'cueList'
const PLAYHEAD_SUBSCRIPTION = 'playhead:'
/** Playhead updates from Designer - fast enough for the cue highlight, light on Designer */
const PLAYHEAD_UPDATE_MS = 150
/** Time variables are refreshed at most this often (cue changes are applied immediately) */
const TIME_VARIABLES_MS = 250
/** [track uid, seconds, refresh rate] of a transport (arrays only - see CUE_LIST_EXPRESSION) */
const PLAYHEAD_EXPRESSION =
	'[str(object.player.track.uid), object.player.track.beatToTime(object.player.tRender), state.globalRefreshRate.asDouble]'
const CURRENT_TRANSPORT_SUBSCRIPTION = 'currentTransport'
/** Designer's current transport - with a multi-transport the one whose timeline is selected */
const CURRENT_TRANSPORT_EXPRESSION = 'guisystem.currentTransportManager.description'
/** Seconds a playhead may be before a cue and still count as on it (float noise only) */
const CUE_TIME_TOLERANCE = 0.0005
/** How long to wait for the playhead to confirm a global jump */
const JUMP_CONFIRM_MS = 1500

/** Action option values for the transport */
export const TRANSPORT_AUTO = 'auto'
export const TRANSPORT_CURRENT = 'current'

function emptyState(): DisguiseState {
	return {
		connected: false,
		project: '',
		version: '',
		transports: [],
		currentTransport: '',
		transport: '',
		playmode: '',
		engaged: false,
		trackName: '',
		trackUid: '',
		tracks: [],
		cues: [],
		cueListUpdated: '',
		playheads: [],
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
	private transportsSignature = ''
	/** Transport uids with a playhead subscription */
	private playheadSubscriptions = new Set<string>()
	private lastTimeVariablesUpdate = 0

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
		this.transportsSignature = ''
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

		this.state.connected = true
		this.state.transports = transports
		this.updateMainTransport()

		// Live Update is always needed for the playheads; the cue list subscription only in automatic mode
		this.ensureLiveUpdate(api)
		if (!this.cueAutoUpdate && !wasConnected) {
			// Manual mode: read the cue list once per connection, then only on "Refresh cue list".
			// Only a lost connection fails the poll; a script error is logged and the list stays empty.
			await this.loadCueList(api).catch((e: Error) => {
				if (e instanceof DisguiseConnectionError || e instanceof DisguiseNoProjectError) throw e
			})
		}

		this.applyState()
	}

	/** The main transport: Designer's current one when it is in use, else the first transport in use */
	get mainTransport(): TransportInfo | undefined {
		const transports = this.state.transports
		return transports.find((t) => t.name === this.state.currentTransport) ?? transports[0]
	}

	/** Transport, playmode and track variables follow the main transport */
	private updateMainTransport(): void {
		const transport = this.mainTransport
		this.state.transport = transport?.name ?? ''
		this.state.playmode = transport?.playmode ?? ''
		this.state.engaged = transport?.engaged ?? false
		this.state.trackUid = transport?.currentTrack?.uid ?? ''
		this.state.trackName = transport?.currentTrack?.name ?? ''
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
		if (this.liveUpdateError) {
			const paused = this.cueAutoUpdate ? 'cue highlight and automatic cue list updates' : 'cue highlight'
			this.setStatus(InstanceStatus.UnknownWarning, `Live Update ${this.liveUpdateError} - ${paused} paused`)
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

		// Any resolvable object will do as the anchor of project-wide subscriptions - use the first transport in use
		const anchor = this.state.transports[0]?.name
		if (anchor) {
			// Changes only when the operator selects another transport's timeline in Designer
			this.liveUpdate.subscribe(
				CURRENT_TRANSPORT_SUBSCRIPTION,
				transportObjectPath(anchor),
				CURRENT_TRANSPORT_EXPRESSION,
				(value) => this.setCurrentTransport(value),
				{ onError: (message) => this.log('warn', `Current transport unavailable: ${message}`) },
			)
		}
		if (this.cueAutoUpdate && anchor) {
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

		this.syncPlayheads()
	}

	private setCurrentTransport(value: unknown): void {
		const name = typeof value === 'string' ? value : ''
		if (name === this.state.currentTransport) return
		this.state.currentTransport = name
		this.log('debug', `Current transport: ${name}`)
		this.updateMainTransport()
		this.applyState()
	}

	/** One playhead subscription per transport in use (one transport, or the children of a multi-transport) */
	private syncPlayheads(): void {
		const client = this.liveUpdate
		if (!client) return
		const transports = this.state.transports

		for (const uid of this.playheadSubscriptions) {
			if (transports.some((t) => t.uid === uid)) continue
			client.unsubscribe(PLAYHEAD_SUBSCRIPTION + uid)
			this.playheadSubscriptions.delete(uid)
		}

		const previous = new Map(this.state.playheads.map((p) => [p.uid, p]))
		this.state.playheads = transports.map((t) => {
			const playhead: TransportPlayhead = previous.get(t.uid) ?? {
				uid: t.uid,
				name: t.name,
				varId: '',
				trackUid: t.currentTrack?.uid ?? '',
				trackName: t.currentTrack?.name ?? '',
				time: 0,
				fps: 0,
			}
			playhead.name = t.name
			playhead.varId = t.name.replace(/[^A-Za-z0-9]/g, '_')

			// Re-subscribing with the same object + property is a no-op; a renamed transport gets a new subscription
			client.subscribe(
				PLAYHEAD_SUBSCRIPTION + t.uid,
				transportObjectPath(t.name),
				PLAYHEAD_EXPRESSION,
				(value) => this.setPlayhead(t.uid, value),
				{
					updateFrequencyMs: PLAYHEAD_UPDATE_MS,
					onError: (message) => this.log('warn', `Playhead of transport "${t.name}" unavailable: ${message}`),
				},
			)
			this.playheadSubscriptions.add(t.uid)
			return playhead
		})
	}

	private setPlayhead(uid: string, value: unknown): void {
		const playhead = this.state.playheads.find((p) => p.uid === uid)
		if (!playhead || !Array.isArray(value)) return
		const [trackUid, time, fps] = value as [string | null, number | null, number | null]
		playhead.trackUid = trackUid ?? ''
		playhead.time = Number(time) || 0
		playhead.fps = Number(fps) || playhead.fps

		if (this.updateCurrentCue(playhead)) {
			this.lastTimeVariablesUpdate = Date.now()
			UpdatePlayheadVariableValues(this)
			this.checkFeedbacks('cue_active', 'cue_next')
		} else if (Date.now() - this.lastTimeVariablesUpdate >= TIME_VARIABLES_MS) {
			this.lastTimeVariablesUpdate = Date.now()
			UpdatePlayheadVariableValues(this)
		}
	}

	/** Find the current and next cue of a transport; returns true when they (or its track) changed */
	private updateCurrentCue(playhead: TransportPlayhead): boolean {
		const track = this.state.tracks.find((t) => t.uid === playhead.trackUid)
		const cues = track?.cues ?? []
		// A jump to a cue lands on its time up to float noise, but at the end of a section Designer holds
		// the playhead 2^-10 s (~1 ms) before the next cue - the tolerance must stay well below that
		let index = -1
		while (index + 1 < cues.length && cues[index + 1].time <= playhead.time + CUE_TIME_TOLERANCE) index++

		const cue = cues[index]
		const nextCue = cues[index + 1]
		const trackName = track?.name ?? this.state.transports.find((t) => t.uid === playhead.uid)?.currentTrack?.name ?? ''
		const changed = cue !== playhead.cue || nextCue !== playhead.nextCue || trackName !== playhead.trackName
		playhead.cue = cue
		playhead.nextCue = nextCue
		playhead.trackName = trackName
		return changed
	}

	private closeLiveUpdate(): void {
		this.liveUpdate?.destroy()
		this.liveUpdate = null
		this.liveUpdateError = ''
		this.playheadSubscriptions.clear()
		this.state.playheads = []
		this.state.currentTransport = ''
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
			track.cues.sort((a, b) => a.time - b.time)
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
		const variableSignature = JSON.stringify([
			this.state.cues.map((c) => c.varId),
			this.state.playheads.map((p) => p.varId),
		])
		const tracksSignature = JSON.stringify(this.state.tracks.map((t) => t.name))
		const transportsSignature = JSON.stringify(this.state.transports.map((t) => t.name))

		// The cue list or the transports may have changed - re-evaluate every playhead
		for (const playhead of this.state.playheads) this.updateCurrentCue(playhead)

		if (variableSignature !== this.variableSignature) {
			this.variableSignature = variableSignature
			UpdateVariableDefinitions(this)
		}
		UpdateVariableValues(this)

		if (tracksSignature !== this.tracksSignature) {
			this.tracksSignature = tracksSignature
			this.updateActions() // the track dropdown lists the project tracks
		}

		if (transportsSignature !== this.transportsSignature) {
			this.transportsSignature = transportsSignature
			// The transport dropdowns list the transports in use
			this.updateActions()
			this.updateFeedbacks()
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

		this.checkFeedbacks('connected', 'playmode', 'cue_active', 'cue_next', 'cue_last_triggered')
	}

	/** Locator for the transport option of the transport actions: Designer's current transport or a name */
	transportLocator(option: string | undefined): Locator {
		const name = String(option ?? '').trim()
		return name === '' || name === TRANSPORT_CURRENT || name === TRANSPORT_AUTO ? {} : { name }
	}

	/** Track a transport is on - from its playhead (live) when subscribed, else from the last REST poll */
	private trackOf(transport: TransportInfo): string {
		return this.state.playheads.find((p) => p.uid === transport.uid)?.trackUid || transport.currentTrack?.uid || ''
	}

	/**
	 * Pick the transport for a cue in Auto mode (variant A - the cue goes where its track already plays):
	 * 1. Designer's current transport, if it is on the cue's track;
	 * 2. another transport in use on the cue's track;
	 * 3. Designer's current transport, if the track is in its setlist (it switches tracks);
	 * 4. the first transport in use whose setlist contains the track.
	 */
	private autoTransport(cue: Cue): TransportInfo | undefined {
		const inUse = this.state.transports
		const current = inUse.find((t) => t.name === this.state.currentTransport)
		const inSetlist = (t: TransportInfo) => t.setList?.tracks.some((track) => track.uid === cue.trackUid) ?? false

		if (current && this.trackOf(current) === cue.trackUid) return current
		const playing = inUse.find((t) => this.trackOf(t) === cue.trackUid)
		if (playing) return playing
		if (current && inSetlist(current)) return current
		return inUse.find(inSetlist)
	}

	/**
	 * Jump to a cue. `transportOption` is "auto" (see autoTransport) or a transport name.
	 * A cue on another track than the transport's one is reached with a global jump: Designer switches
	 * the transport to that track (within its setlist). The jump is confirmed through the playhead.
	 */
	async triggerCue(cueId: string, playmode: PlayMode, transportOption: string, forceGlobal: boolean): Promise<void> {
		const api = this.getApi()
		const cue = this.state.cues.find((c) => c.id === cueId)
		const option = String(transportOption ?? '').trim() || TRANSPORT_AUTO

		let transport: TransportInfo | undefined
		if (option === TRANSPORT_AUTO) {
			if (cue) {
				transport = this.autoTransport(cue)
				if (!transport) {
					throw new Error(`Cue ${cueId}: track "${cue.trackName}" is not in the setlist of any transport in use`)
				}
			} else {
				// Unknown cue (cue list not read yet / just created) - let Designer's current transport look for it
				transport = this.mainTransport
			}
		} else {
			transport =
				this.state.transports.find((t) => t.name === option) ??
				(await api.getTransports()).find((t) => t.name === option)
			if (!transport) throw new Error(`Transport "${option}" not found`)
		}
		if (!transport) {
			await api.goToCue(cueId, playmode, forceGlobal)
			return
		}

		const onOtherTrack = !!cue && this.trackOf(transport) !== cue.trackUid
		if (cue && onOtherTrack && transport.setList && !transport.setList.tracks.some((t) => t.uid === cue.trackUid)) {
			throw new Error(
				`Cue ${cueId} is on track "${cue.trackName}", which is not in the setlist of transport "${transport.name}"`,
			)
		}

		const global = forceGlobal || onOtherTrack
		this.log('debug', `Cue ${cueId} -> transport "${transport.name}"${global ? ' (global jump)' : ''}`)
		try {
			await api.goToCue(cueId, playmode, global, { uid: transport.uid })
		} catch (e) {
			// With allowGlobalJump Designer answers "Not every transport has been moved" even after a
			// successful jump - tolerated for a known cue, then confirmed through the playhead below
			const falseWarning =
				global && !!cue && e instanceof DisguiseCommandError && e.message.includes('Not every transport has been moved')
			if (!falseWarning) throw e
		}

		if (cue && onOtherTrack) await this.confirmTrack(transport, cue)
	}

	/** Wait until the playhead of the transport reports the cue's track (only for subscribed transports) */
	private async confirmTrack(transport: TransportInfo, cue: Cue): Promise<void> {
		if (!this.state.playheads.some((p) => p.uid === transport.uid)) return
		const deadline = Date.now() + JUMP_CONFIRM_MS
		while (Date.now() < deadline) {
			if (this.state.playheads.find((p) => p.uid === transport.uid)?.trackUid === cue.trackUid) return
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		throw new Error(`Transport "${transport.name}" did not switch to track "${cue.trackName}" for cue ${cue.id}`)
	}

	/** Remember the last cue triggered from Companion (independent of the playhead) */
	setLastCue(cue: string): void {
		this.state.lastCue = cue
		UpdateVariableValues(this)
		this.checkFeedbacks('cue_last_triggered')
	}
}
