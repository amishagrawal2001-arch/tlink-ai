import { Server } from 'http'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'

interface SharedSession {
    id: string
    token: string
    mode: 'read-only' | 'interactive'
    password?: string
    expiresAt?: Date
    viewers: Set<WebSocket>
    createdAt: Date
}

export class SessionSharingServer {
    private httpServer: Server | null = null
    private wss: WebSocketServer | null = null
    private port = 0 // 0 means auto-assign
    private host = '0.0.0.0' // Bind to all interfaces for network access
    private sessions = new Map<string, SharedSession>()
    private started = false
    private publicUrl: string | null = null // Public URL if tunnel is active

    /**
     * Start the WebSocket server
     * @param port Port number (0 for auto-assign)
     * @param host Host to bind to ('127.0.0.1' for localhost only, '0.0.0.0' for all interfaces)
     */
    async start (port: number = 0, host: string = '0.0.0.0'): Promise<number> {
        if (this.started && this.wss) {
            return this.port
        }

        this.host = host

        return new Promise((resolve, reject) => {
            try {
                this.httpServer = createServer()
                this.wss = new WebSocketServer({ 
                    server: this.httpServer,
                    path: '/session',
                })

                this.wss.on('connection', (ws: WebSocket, req) => {
                    this.handleConnection(ws, req)
                })

                this.wss.on('error', (error) => {
                    console.error('WebSocket server error:', error)
                })

                this.httpServer.listen(port, this.host, () => {
                    const address = this.httpServer!.address()
                    if (address && typeof address === 'object') {
                        this.port = address.port
                    } else if (typeof address === 'number') {
                        this.port = address
                    }
                    this.started = true
                    
                    const bindAddress = this.host === '0.0.0.0' ? 'all interfaces' : this.host
                    console.log(`Session sharing WebSocket server started on ${bindAddress}:${this.port}`)
                    console.log(`Local URL: ws://127.0.0.1:${this.port}/session`)
                    if (this.host === '0.0.0.0') {
                        console.log(`Network URL: ws://<your-ip>:${this.port}/session (accessible on local network)`)
                        console.log(`Note: For internet access, configure port forwarding or use a tunneling service`)
                    }
                    
                    resolve(this.port)
                })

                this.httpServer.on('error', (error) => {
                    console.error('HTTP server error:', error)
                    reject(error)
                })
            } catch (error) {
                console.error('Failed to start WebSocket server:', error)
                reject(error)
            }
        })
    }

    /**
     * Stop the WebSocket server
     */
    async stop (): Promise<void> {
        return new Promise((resolve) => {
            if (this.wss) {
                this.wss.close(() => {
                    console.log('WebSocket server closed')
                    this.wss = null
                    resolve()
                })
            } else {
                resolve()
            }
            if (this.httpServer) {
                this.httpServer.close(() => {
                    console.log('HTTP server closed')
                    this.httpServer = null
                })
            }
            this.sessions.clear()
            this.started = false
            this.port = 0
            this.publicUrl = null
        })
    }

    /**
     * Register a new shared session
     */
    registerSession (sessionId: string, token: string, mode: 'read-only' | 'interactive', password?: string, expiresIn?: number): void {
        // Clean up expired sessions
        this.cleanupExpiredSessions()

        const session: SharedSession = {
            id: sessionId,
            token,
            mode,
            password,
            expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 60 * 1000) : undefined,
            viewers: new Set(),
            createdAt: new Date(),
        }

        this.sessions.set(sessionId, session)
        console.log(`Session registered: ${sessionId} (mode: ${mode})`)
    }

    /**
     * Unregister a shared session
     */
    unregisterSession (sessionId: string): void {
        const session = this.sessions.get(sessionId)
        if (session) {
            // Close all viewer connections
            for (const viewer of session.viewers) {
                viewer.close()
            }
            this.sessions.delete(sessionId)
            console.log(`Session unregistered: ${sessionId}`)
        }
    }

    /**
     * Broadcast terminal output to all viewers
     */
    broadcastOutput (sessionId: string, data: Buffer): void {
        const session = this.sessions.get(sessionId)
        if (!session || session.viewers.size === 0) {
            return
        }

        // Check if session is expired
        if (session.expiresAt && new Date() > session.expiresAt) {
            this.unregisterSession(sessionId)
            return
        }

        const message = JSON.stringify({
            type: 'output',
            data: data.toString('base64'),
        })

        // Broadcast to all viewers
        for (const viewer of session.viewers) {
            if (viewer.readyState === WebSocket.OPEN) {
                viewer.send(message)
            }
        }
    }

    /**
     * Forward input from viewer to terminal (for interactive mode)
     */
    forwardInput (sessionId: string, data: Buffer, viewerWs: WebSocket): void {
        const session = this.sessions.get(sessionId)
        if (!session || session.mode !== 'interactive') {
            return
        }

        // Check if session is expired
        if (session.expiresAt && new Date() > session.expiresAt) {
            this.unregisterSession(sessionId)
            return
        }

        // Verify this viewer is connected
        if (!session.viewers.has(viewerWs)) {
            return
        }

        // Send input event (this will be handled by IPC in the main process)
        // For now, we'll emit an event that can be listened to via IPC
        process.emit('session-sharing:input' as any, sessionId, data)
    }

    /**
     * Get the server port
     */
    getPort (): number {
        return this.port
    }

    /**
     * Get the WebSocket URL
     * @param usePublicUrl If true, returns public URL (if tunnel is active), otherwise local URL
     */
    getWebSocketUrl (usePublicUrl: boolean = false): string {
        if (usePublicUrl && this.publicUrl) {
            return this.publicUrl
        }
        
        // If bound to 0.0.0.0, return localhost URL for sharing (viewers should use their network IP)
        const host = this.host === '0.0.0.0' ? '127.0.0.1' : this.host
        return `ws://${host}:${this.port}/session`
    }

    /**
     * Get the network-accessible URL (for local network sharing)
     * This requires the user to know their IP address
     */
    getNetworkUrl (): string {
        return `ws://<your-ip>:${this.port}/session`
    }

    /**
     * Set public URL (for tunneling services like ngrok)
     */
    setPublicUrl (url: string | null): void {
        this.publicUrl = url
        if (url) {
            console.log(`Session sharing public URL: ${url}`)
        }
    }

    /**
     * Get public URL if available
     */
    getPublicUrl (): string | null {
        return this.publicUrl
    }

    /**
     * Get the bind host
     */
    getHost (): string {
        return this.host
    }

    /**
     * Check if server is started
     */
    isStarted (): boolean {
        return this.started
    }

    /**
     * Get active session count
     */
    getActiveSessionCount (): number {
        this.cleanupExpiredSessions()
        return this.sessions.size
    }

    /**
     * Get viewer count for a session
     */
    getViewerCount (sessionId: string): number {
        const session = this.sessions.get(sessionId)
        if (!session) {
            return 0
        }
        // Clean up disconnected viewers
        for (const viewer of session.viewers) {
            if (viewer.readyState !== WebSocket.OPEN && viewer.readyState !== WebSocket.CONNECTING) {
                session.viewers.delete(viewer)
            }
        }
        return session.viewers.size
    }

    /**
     * Handle new WebSocket connection
     */
    private handleConnection (ws: WebSocket, _req: any): void {
        console.log('New WebSocket connection')

        ws.on('message', (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString())
                this.handleMessage(ws, message)
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error)
                ws.close(1003, 'Invalid message format')
            }
        })

        ws.on('error', (error) => {
            console.error('WebSocket connection error:', error)
        })

        ws.on('close', () => {
            this.handleDisconnection(ws)
        })
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleMessage (ws: WebSocket, message: any): void {
        switch (message.type) {
            case 'join':
                this.handleJoin(ws, message)
                break
            case 'input':
                this.handleInput(ws, message)
                break
            default:
                console.warn('Unknown message type:', message.type)
                ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }))
        }
    }

    /**
     * Handle viewer joining a session
     */
    private handleJoin (ws: WebSocket, message: any): void {
        const { sessionId, token, password } = message

        const session = this.sessions.get(sessionId)
        if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }))
            ws.close(1008, 'Session not found')
            return
        }

        // Verify token
        if (session.token !== token) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }))
            ws.close(1008, 'Invalid token')
            return
        }

        // Check if expired
        if (session.expiresAt && new Date() > session.expiresAt) {
            this.unregisterSession(sessionId)
            ws.send(JSON.stringify({ type: 'error', message: 'Session expired' }))
            ws.close(1008, 'Session expired')
            return
        }

        // Verify password if required
        if (session.password && session.password !== password) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid password' }))
            ws.close(1008, 'Invalid password')
            return
        }

        // Add viewer
        session.viewers.add(ws)

        // Send success message
        ws.send(JSON.stringify({
            type: 'joined',
            sessionId: session.id,
            mode: session.mode,
            viewerCount: session.viewers.size,
        }))

        // Notify session owner via IPC (if needed)
        process.emit('session-sharing:viewer-joined' as any, sessionId, session.viewers.size)

        console.log(`Viewer joined session ${sessionId} (total viewers: ${session.viewers.size})`)
    }

    /**
     * Handle input from viewer (interactive mode)
     */
    private handleInput (ws: WebSocket, message: any): void {
        const { sessionId, data } = message

        const session = this.sessions.get(sessionId)
        if (!session) {
            return
        }

        // Verify viewer is connected
        if (!session.viewers.has(ws)) {
            return
        }

        // Only allow input in interactive mode
        if (session.mode !== 'interactive') {
            ws.send(JSON.stringify({ type: 'error', message: 'Session is read-only' }))
            return
        }

        // Forward input to terminal
        try {
            const inputData = Buffer.from(data, 'base64')
            this.forwardInput(sessionId, inputData, ws)
        } catch (error) {
            console.error('Failed to decode input data:', error)
        }
    }

    /**
     * Handle viewer disconnection
     */
    private handleDisconnection (ws: WebSocket): void {
        // Remove viewer from all sessions
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.viewers.has(ws)) {
                session.viewers.delete(ws)
                console.log(`Viewer disconnected from session ${sessionId} (remaining viewers: ${session.viewers.size})`)
                
                // Notify session owner via IPC
                process.emit('session-sharing:viewer-left' as any, sessionId, session.viewers.size)

                // If no viewers left and session is expired, clean it up
                if (session.viewers.size === 0 && session.expiresAt && new Date() > session.expiresAt) {
                    this.unregisterSession(sessionId)
                }
                break
            }
        }
    }

    /**
     * Clean up expired sessions
     */
    private cleanupExpiredSessions (): void {
        const now = new Date()
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expiresAt && now > session.expiresAt) {
                console.log(`Cleaning up expired session: ${sessionId}`)
                this.unregisterSession(sessionId)
            }
        }
    }
}

// Singleton instance
let serverInstance: SessionSharingServer | null = null

export function getSessionSharingServer (): SessionSharingServer {
    if (!serverInstance) {
        serverInstance = new SessionSharingServer()
    }
    return serverInstance
}

