// Thin client for the Disguise Designer Session REST API (/api/session/...)

export type PlayMode = 'NotSet' | 'Play' | 'PlaySection' | 'Loop' | 'Stop' | 'Unknown'
export type TagType = 'TagType_Unknown' | 'TC' | 'MIDI' | 'CUE'

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

export interface CueInfo {
	note?: { time: number; text: string }
	tags: { time: number; type: TagType; value: string }[]
	section?: { time: number; index: string }
}

/** Error thrown when Designer can not be reached at all (network / timeout) */
export class DisguiseConnectionError extends Error {}

/** Error thrown when Designer answers but has no project running (HTTP 502) */
export class DisguiseNoProjectError extends Error {}

/** Error thrown when Designer refuses a command (HTTP error or non-zero status on a POST) */
export class DisguiseCommandError extends Error {}

export class DisguiseApi {
	readonly baseUrl: string
	private readonly timeoutMs: number

	constructor(host: string, port: number, timeoutMs: number) {
		const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
		this.baseUrl = `http://${hostPart}:${port}/api/session`
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

	async getTracks(): Promise<TrackInfo[]> {
		return (await this.request<{ status: ApiStatus; result: TrackInfo[] }>('GET', 'transport/tracks')).result
	}

	/** Cues of a track (the active track when no uid is given) */
	async getCues(trackUid?: string): Promise<CueInfo[]> {
		const query = trackUid ? `?uid=${encodeURIComponent(trackUid)}` : ''
		return (await this.request<{ status: ApiStatus; cues?: CueInfo[] }>('GET', `transport/cues${query}`)).cues ?? []
	}

	// --- Commands (always on the active transport) ---

	private async simple(path: string): Promise<void> {
		await this.request('POST', `transport/${path}`, { transports: [{}] })
	}

	private async withPlaymode(path: string, info: Record<string, unknown>, playmode?: PlayMode): Promise<void> {
		const entry: Record<string, unknown> = { transport: {}, ...info }
		if (playmode && playmode !== 'NotSet') entry.playmode = playmode
		await this.request('POST', `transport/${path}`, { transports: [entry] })
	}

	async play(): Promise<void> {
		await this.simple('play')
	}

	async playSection(): Promise<void> {
		await this.simple('playsection')
	}

	async playLoopSection(): Promise<void> {
		await this.simple('playloopsection')
	}

	async stop(): Promise<void> {
		await this.simple('stop')
	}

	async returnToStart(): Promise<void> {
		await this.simple('returntostart')
	}

	async goToCue(cue: string, playmode?: PlayMode, allowGlobalJump = false): Promise<void> {
		await this.withPlaymode('gototag', { type: 'CUE', value: cue, allowGlobalJump }, playmode)
	}

	async goToSection(index: number, playmode?: PlayMode): Promise<void> {
		await this.withPlaymode('gotosection', { section: String(index) }, playmode)
	}

	async goToNextSection(playmode?: PlayMode): Promise<void> {
		await this.withPlaymode('gotonextsection', {}, playmode)
	}

	async goToPrevSection(playmode?: PlayMode): Promise<void> {
		await this.withPlaymode('gotoprevsection', {}, playmode)
	}

	async goToTrack(track: Locator, playmode?: PlayMode): Promise<void> {
		await this.withPlaymode('gototrack', { track }, playmode)
	}

	async goToNextTrack(playmode?: PlayMode): Promise<void> {
		await this.withPlaymode('gotonexttrack', {}, playmode)
	}

	async goToPrevTrack(playmode?: PlayMode): Promise<void> {
		await this.withPlaymode('gotoprevtrack', {}, playmode)
	}

	async goToTimecode(timecode: string, ignoreTags: boolean, playmode?: PlayMode): Promise<void> {
		await this.withPlaymode('gototimecode', { timecode, ignoreTags }, playmode)
	}
}

function statusText(status: ApiStatus | undefined): string {
	if (!status) return ''
	const details = (status.details ?? []).map((d) => d.message).filter((m): m is string => !!m)
	return [status.message, ...details].filter((m) => !!m).join(' - ')
}
