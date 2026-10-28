// Client for the Disguise Designer Live Update websocket (/api/session/liveupdate)

export interface LiveUpdateCallbacks {
	/** Socket opened (all registered subscriptions have been sent again) */
	onOpen: () => void
	/** Socket closed or failed; reconnecting is up to the owner (see connect()) */
	onClose: (reason: string) => void
	log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
}

interface Subscription {
	object: string
	property: string
	updateFrequencyMs?: number
	onValue: (value: unknown) => void
	onError?: (message: string) => void
	/** Id assigned by Designer, known after the `subscriptions` message */
	id?: number
}

interface SubscriptionsMessage {
	subscriptions?: { id: number; objectPath: string; propertyPath: string }[]
	valuesChanged?: { id: number; value: unknown }[]
	error?: string
}

/** Designer object path of a transport (names are addressed with spaces as underscores) */
export function transportObjectPath(transportName: string): string {
	return `transportManager:${transportName.replace(/ /g, '_')}`
}

export class LiveUpdateClient {
	private ws: WebSocket | null = null
	private open = false
	private readonly subscriptions = new Map<string, Subscription>()

	constructor(
		private readonly url: string,
		private readonly callbacks: LiveUpdateCallbacks,
	) {}

	get isOpen(): boolean {
		return this.open
	}

	/** Open the socket unless it is already open or opening. Safe to call on every poll. */
	connect(): void {
		if (this.ws) return
		let ws: WebSocket
		try {
			ws = new WebSocket(this.url)
		} catch (e) {
			this.callbacks.onClose((e as Error).message)
			return
		}
		this.ws = ws

		ws.onopen = () => {
			if (this.ws !== ws) return
			this.open = true
			for (const sub of this.subscriptions.values()) {
				sub.id = undefined
				this.sendSubscribe(sub)
			}
			this.callbacks.onOpen()
		}
		ws.onmessage = (event) => {
			if (this.ws !== ws) return
			this.handleMessage(String(event.data))
		}
		ws.onerror = () => {
			// onclose follows with the details
		}
		ws.onclose = (event) => {
			if (this.ws !== ws) return
			const wasOpen = this.open
			this.ws = null
			this.open = false
			this.callbacks.onClose(wasOpen ? `closed (${event.code})` : 'unable to connect')
		}
	}

	/** Close the socket and forget every subscription */
	destroy(): void {
		this.subscriptions.clear()
		const ws = this.ws
		this.ws = null
		this.open = false
		if (ws) {
			ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
			ws.close()
		}
	}

	/** Add (or replace) a subscription under our own key; it survives reconnects */
	subscribe(
		key: string,
		object: string,
		property: string,
		onValue: (value: unknown) => void,
		options: { updateFrequencyMs?: number; onError?: (message: string) => void } = {},
	): void {
		const existing = this.subscriptions.get(key)
		if (
			existing &&
			existing.object === object &&
			existing.property === property &&
			existing.updateFrequencyMs === options.updateFrequencyMs
		) {
			existing.onValue = onValue
			existing.onError = options.onError
			return
		}
		if (existing) this.unsubscribe(key)

		const sub: Subscription = { object, property, onValue, ...options }
		this.subscriptions.set(key, sub)
		if (this.open) this.sendSubscribe(sub)
	}

	unsubscribe(key: string): void {
		const sub = this.subscriptions.get(key)
		if (!sub) return
		this.subscriptions.delete(key)
		// Only the id form is honoured by Designer; ids are reference counted per object+property
		if (this.open && sub.id !== undefined) this.send({ unsubscribe: { id: sub.id } })
	}

	hasSubscription(key: string): boolean {
		return this.subscriptions.has(key)
	}

	private sendSubscribe(sub: Subscription): void {
		this.send({
			subscribe: {
				object: sub.object,
				properties: [sub.property],
				configuration: sub.updateFrequencyMs ? { updateFrequencyMs: sub.updateFrequencyMs } : undefined,
			},
		})
	}

	private send(message: unknown): void {
		if (!this.ws || !this.open) return
		try {
			this.ws.send(JSON.stringify(message))
		} catch (e) {
			this.callbacks.log('warn', `Live Update send failed: ${(e as Error).message}`)
		}
	}

	private handleMessage(data: string): void {
		let message: SubscriptionsMessage
		try {
			message = JSON.parse(data) as SubscriptionsMessage
		} catch {
			this.callbacks.log('debug', `Live Update: unparsable message ${data.slice(0, 200)}`)
			return
		}

		if (message.error) {
			this.callbacks.log('warn', `Live Update: ${message.error}`)
			// A subscription whose object can not be resolved is not created - report it to its owner
			for (const sub of this.subscriptions.values()) {
				if (sub.id === undefined && message.error.includes(sub.object)) sub.onError?.(message.error)
			}
		}

		if (message.subscriptions) {
			// The full list of this connection's subscriptions - match ids by object + property
			for (const entry of message.subscriptions) {
				for (const sub of this.subscriptions.values()) {
					if (sub.object === entry.objectPath && sub.property === entry.propertyPath) sub.id = entry.id
				}
			}
		}

		for (const change of message.valuesChanged ?? []) {
			for (const sub of this.subscriptions.values()) {
				if (sub.id !== change.id) continue
				const value = change.value as { errorType?: string; message?: string } | null
				if (value && typeof value === 'object' && !Array.isArray(value) && value.errorType) {
					sub.onError?.(value.message ?? value.errorType)
				} else {
					sub.onValue(change.value)
				}
			}
		}
	}
}
