// Thin client for the Disguise Designer Session REST API (/api/session/...)

export type PlayMode = 'NotSet' | 'Play' | 'PlaySection' | 'Loop' | 'Stop' | 'Unknown'

export interface Locator {
	uid?: string
	name?: string
}

export interface ApiStatus {
	code: number
	message: string
	details?: { message?: string }[]
}

export interface ProjectInfo {
	projectPath: string
	version: { major: number; minor: number; hotfix: number; revision: number; releaseType?: string }
}

export interface TrackInfo {
	uid: string
	name: string
	length: number
}

export interface TransportInfo {
	uid: string
	name: string
	engaged: boolean
	volume: number
	brightness: number
	playmode: PlayMode
	currentTrack?: Locator
	receivingTimecode: boolean
	setList?: { uid: string; name: string; tracks: TrackInfo[] }
	speed: number
}

/** Raw cue list of one track: [track uid, track name, [[cue, note, seconds], ...]] */
export type RawTrackCues = [string, string, [string, string, number][]]

/**
 * Python expression returning the CUE tags and notes of every track in the project.
 * Used both for the Live Update subscription and for a one-off Python execute.
 * Must return nested arrays: dicts inside nested lists are never delivered by Live Update.
 */
export const CUE_LIST_EXPRESSION =
	"[[str(t.uid), t.description, [[g.text, t.cues.getV(i).note, t.beatToTime(t.cues.getT(i))] for i in range(t.cues.n()) for g in t.cues.getV(i).getTags() if int(g.type) == 1]] for t in resourceManager.allResources(Track) if str(t.path).startswith('objects/')]"

/** Error thrown when Designer can not be reached at all (network / timeout) */
export class DisguiseConnectionError extends Error {}

/** Error thrown when Designer answers but has no project running (HTTP 502) */
export class DisguiseNoProjectError extends Error {}

/** Error thrown when Designer refuses a command (HTTP error or non-zero status on a POST) */
export class DisguiseCommandError extends Error {}

export class DisguiseApi {
	readonly baseUrl: string
	readonly liveUpdateUrl: string
	private readonly timeoutMs: number

	constructor(host: string, port: number, timeoutMs: number) {
		const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
		this.baseUrl = `http://${hostPart}:${port}/api/session`
		this.liveUpdateUrl = `ws://${hostPart}:${port}/api/session/liveupdate`
		this.timeoutMs = timeoutMs
	}

	private async request<T extends { status?: ApiStatus }>(
		method: 'GET' | 'POST',
		path: string,
		body?: unknown,
	): Promise<T> {
		let response: Response
		try {
			response = await fetch(`${this.baseUrl}/${path}`, {
				method,
				headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
			})
		} catch (e) {
			const err = e as Error & { cause?: { code?: string } }
			const reason = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code ?? err.message)
			throw new DisguiseConnectionError(`Designer unreachable (${reason})`)
		}

		if (response.status === 502 || response.status === 503) {
			throw new DisguiseNoProjectError('Designer is not running a project')
		}

		let data: T
		try {
			data = (await response.json()) as T
		} catch {
			throw new DisguiseCommandError(`Invalid response from Designer (HTTP ${response.status})`)
		}

		if (!response.ok) {
			throw new DisguiseCommandError(statusText(data.status) || `Designer HTTP ${response.status}`)
		}

		// A non-zero status on a GET is a warning (data is still complete), on a POST the command did not apply
		if (method === 'POST' && data.status && data.status.code !== 0) {
			throw new DisguiseCommandError(statusText(data.status) || `Designer status ${data.status.code}`)
		}

		return data
	}

	// --- Reads ---

	async getProject(): Promise<ProjectInfo> {
		return (await this.request<{ status: ApiStatus; result: ProjectInfo }>('GET', 'status/project')).result
	}

	/** Active transport(s) - more than one when a multi-transport is selected */
	async getActiveTransport(): Promise<TransportInfo[]> {
		return (await this.request<{ status: ApiStatus; result: TransportInfo[] }>('GET', 'transport/activetransport'))
			.result
	}

	/** Cues of all tracks in one request - one-off reads only, Python execute must never be polled */
	async getAllCues(): Promise<RawTrackCues[]> {
		const data = await this.request<{ status: ApiStatus; returnValue?: unknown }>('POST', 'python/execute', {
			script: `return ${CUE_LIST_EXPRESSION}`,
		})
		const value = typeof data.returnValue === 'string' ? (JSON.parse(data.returnValue) as unknown) : data.returnValue
		if (!Array.isArray(value)) throw new DisguiseCommandError('Unexpected cue list returned by Designer')
		return value as RawTrackCues[]
	}

	/** Every transport of the project, engaged or not (multi-transports are listed separately and ignored here) */
	async getTransports(): Promise<TransportInfo[]> {
		return (
			(await this.request<{ status: ApiStatus; transports?: TransportInfo[] }>('GET', 'transport/transports'))
				.transports ?? []
		)
	}

	// --- Commands ---
	// `transport` selects the transport; an empty locator ({}) lets Designer use its current transport
	// (with a multi-transport: the one whose timeline is selected)

	private async simple(path: string, transport: Locator): Promise<void> {
		await this.request('POST', `transport/${path}`, { transports: [transport] })
	}

	private async withPlaymode(
		path: string,
		transport: Locator,
		info: Record<string, unknown>,
		playmode?: PlayMode,
	): Promise<void> {
		const entry: Record<string, unknown> = { transport, ...info }
		if (playmode && playmode !== 'NotSet') entry.playmode = playmode
		await this.request('POST', `transport/${path}`, { transports: [entry] })
	}

	async play(transport: Locator = {}): Promise<void> {
		await this.simple('play', transport)
	}

	async playSection(transport: Locator = {}): Promise<void> {
		await this.simple('playsection', transport)
	}

	async playLoopSection(transport: Locator = {}): Promise<void> {
		await this.simple('playloopsection', transport)
	}

	async stop(transport: Locator = {}): Promise<void> {
		await this.simple('stop', transport)
	}

	async returnToStart(transport: Locator = {}): Promise<void> {
		await this.simple('returntostart', transport)
	}

	async setEngaged(engaged: boolean, transport: Locator = {}): Promise<void> {
		await this.request('POST', 'transport/engaged', { transports: [{ transport, engaged }] })
	}

	async goToCue(cue: string, playmode?: PlayMode, allowGlobalJump = false, transport: Locator = {}): Promise<void> {
		await this.withPlaymode('gototag', transport, { type: 'CUE', value: cue, allowGlobalJump }, playmode)
	}

	async goToSection(index: number, playmode?: PlayMode, transport: Locator = {}): Promise<void> {
		await this.withPlaymode('gotosection', transport, { section: String(index) }, playmode)
	}

	async goToNextSection(playmode?: PlayMode, transport: Locator = {}): Promise<void> {
		await this.withPlaymode('gotonextsection', transport, {}, playmode)
	}

	async goToPrevSection(playmode?: PlayMode, transport: Locator = {}): Promise<void> {
		await this.withPlaymode('gotoprevsection', transport, {}, playmode)
	}

	async goToTrack(track: Locator, playmode?: PlayMode, transport: Locator = {}): Promise<void> {
		await this.withPlaymode('gototrack', transport, { track }, playmode)
	}

	async goToNextTrack(playmode?: PlayMode, transport: Locator = {}): Promise<void> {
		await this.withPlaymode('gotonexttrack', transport, {}, playmode)
	}

	async goToPrevTrack(playmode?: PlayMode, transport: Locator = {}): Promise<void> {
		await this.withPlaymode('gotoprevtrack', transport, {}, playmode)
	}

	async goToTimecode(
		timecode: string,
		ignoreTags: boolean,
		playmode?: PlayMode,
		transport: Locator = {},
	): Promise<void> {
		await this.withPlaymode('gototimecode', transport, { timecode, ignoreTags }, playmode)
	}
}

function statusText(status: ApiStatus | undefined): string {
	if (!status) return ''
	const details = (status.details ?? []).map((d) => d.message).filter((m): m is string => !!m)
	return [status.message, ...details].filter((m) => !!m).join(' - ')
}
