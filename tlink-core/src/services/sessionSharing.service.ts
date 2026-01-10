import { Injectable } from '@angular/core'
import { v4 as uuidv4 } from 'uuid'
import { Logger, LogService } from './log.service'
import { PlatformService } from '../api/platform'
import { BaseTerminalTabComponent } from 'tlink-terminal'

export interface SharedSession {
    id: string
    terminal: any // Terminal tab reference
    token: string
    mode: 'read-only' | 'interactive'
    createdAt: Date
    expiresAt?: Date
    password?: string
    viewers: number
}

export interface SessionSharingOptions {
    mode: 'read-only' | 'interactive'
    expiresIn?: number // minutes
    password?: string
}

@Injectable({ providedIn: 'root' })
export class SessionSharingService {
    private logger: Logger
    private sharedSessions = new Map<string, SharedSession>()
    private terminalToSessionId = new WeakMap<any, string>() // Maps terminal tab reference to shared session ID
    private sessionIdToTerminal = new Map<string, any>() // Maps session ID to terminal tab reference
    private ws: WebSocket | null = null
    private wsUrl = 'ws://localhost:8080' // Default WebSocket server URL

    constructor (
        log: LogService,
        private platform: PlatformService,
    ) {
        this.logger = log.create('sessionSharing')
    }

    /**
     * Prompt user to start WebSocket server
     */
    private async promptToStartServer (): Promise<boolean> {
        try {
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: 'Session Sharing Server Not Running',
                detail: 'The WebSocket server is not running. You need to start it before sharing sessions.\n\nWould you like to start it now?',
                buttons: ['Start Server', 'Cancel'],
                defaultId: 0,
                cancelId: 1,
            })
            return result.response === 0
        } catch (error) {
            this.logger.error('Failed to show prompt:', error)
            return false
        }
    }

    /**
     * Generate a shareable link for a terminal session
     */
    async shareSession (
        terminal: BaseTerminalTabComponent<any>,
        options: SessionSharingOptions,
    ): Promise<string | null> {
        // Check if WebSocket server is running
        const ipcRenderer = this.getIpcRenderer()
        if (ipcRenderer) {
            try {
                const isRunning = await ipcRenderer.invoke('session-sharing:is-server-running')
                if (!isRunning) {
                    // Prompt user to start server
                    const shouldStart = await this.promptToStartServer()
                    if (shouldStart) {
                        const result = await ipcRenderer.invoke('session-sharing:start-server')
                        if (!result.success) {
                            this.logger.error('Failed to start WebSocket server:', result.error)
                            return null
                        }
                        this.logger.info('WebSocket server started, continuing with session share')
                    } else {
                        this.logger.info('Session sharing cancelled - server not running')
                        return null
                    }
                }
            } catch (error) {
                this.logger.debug('Could not check server status, continuing anyway:', error)
            }
        }

        try {
            const sessionId = uuidv4()
            const token = uuidv4()

            const sharedSession: SharedSession = {
                id: sessionId,
                terminal,
                token,
                mode: options.mode,
                createdAt: new Date(),
                expiresAt: options.expiresIn
                    ? new Date(Date.now() + options.expiresIn * 60 * 1000)
                    : undefined,
                password: options.password,
                viewers: 0,
            }

            this.sharedSessions.set(sessionId, sharedSession)
            this.terminalToSessionId.set(terminal, sessionId)
            this.sessionIdToTerminal.set(sessionId, terminal)

            // Register session with embedded WebSocket server via IPC (if in Electron)
            try {
                const ipcRenderer = this.getIpcRenderer()
                if (ipcRenderer) {
                    await ipcRenderer.invoke('session-sharing:register', sessionId, token, options.mode, options.password, options.expiresIn)
                    this.logger.info('Session registered with embedded server via IPC')
                } else {
                    // Fallback: try direct WebSocket connection (for future cloud/web support)
                    await this.connectWebSocket()
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({
                            type: 'register',
                            sessionId: sharedSession.id,
                            token: sharedSession.token,
                            mode: sharedSession.mode,
                        }))
                    }
                }
            } catch (error) {
                // Server not available - this is OK for now
                // Session can still be shared via URL, but real-time sharing won't work
                this.logger.debug('Session sharing server not available, session can still be shared via URL:', error)
            }

            const baseUrl = await this.getBaseUrl()
            const shareUrl = `${baseUrl}/session/${sessionId}${token.substring(0, 8)}`

            this.logger.info('Session shared:', sessionId, shareUrl)
            
            // Note: The decorator will automatically attach when it detects the terminal is shared
            // Since decorators are attached when terminals are created, we need to wait a bit
            // for the decorator to re-check. For now, this is handled by the decorator checking
            // on attach. In the future, we could use an observable to notify decorators.
            
            return shareUrl
        } catch (error) {
            this.logger.error('Failed to share session:', error)
            return null
        }
    }

    /**
     * Stop sharing a session
     */
    async stopSharing (terminal: BaseTerminalTabComponent<any>): Promise<void> {
        try {
            const sessionId = this.terminalToSessionId.get(terminal)
            if (!sessionId) {
                return
            }

            const sharedSession = this.sharedSessions.get(sessionId)
            if (sharedSession) {
                // Unregister session with embedded WebSocket server via IPC (if in Electron)
                try {
                    const ipcRenderer = this.getIpcRenderer()
                    if (ipcRenderer) {
                        await ipcRenderer.invoke('session-sharing:unregister', sessionId)
                    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({
                            type: 'unregister',
                            sessionId: sharedSession.id,
                        }))
                    }
                } catch (error) {
                    this.logger.debug('Failed to unregister session with server:', error)
                }

                this.sharedSessions.delete(sessionId)
                this.terminalToSessionId.delete(terminal)
                this.sessionIdToTerminal.delete(sessionId)
            }

            this.logger.info('Session sharing stopped:', sessionId)
        } catch (error) {
            this.logger.error('Failed to stop sharing session:', error)
        }
    }

    /**
     * Check if a session is currently shared
     */
    isSessionShared (terminal: BaseTerminalTabComponent<any>): boolean {
        return this.terminalToSessionId.has(terminal)
    }

    /**
     * Get the shared session for a terminal
     */
    getSharedSession (terminal: BaseTerminalTabComponent<any>): SharedSession | null {
        const sessionId = this.terminalToSessionId.get(terminal)
        if (!sessionId) {
            return null
        }
        return this.sharedSessions.get(sessionId) || null
    }

    /**
     * Copy shareable link to clipboard
     */
    async copyShareableLink (terminal: BaseTerminalTabComponent<any>): Promise<boolean> {
        const sharedSession = this.getSharedSession(terminal)
        if (!sharedSession) {
            return false
        }

        const baseUrl = await this.getBaseUrl()
        const shareUrl = `${baseUrl}/session/${sharedSession.id}${sharedSession.token.substring(0, 8)}`

        try {
            this.platform.setClipboard({ text: shareUrl })
            return true
        } catch (error) {
            this.logger.error('Failed to copy link to clipboard:', error)
            return false
        }
    }

    /**
     * Join a shared session
     */
    async joinSession (sessionId: string, token: string, password?: string): Promise<boolean> {
        try {
            await this.connectWebSocket()
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.logger.error('WebSocket not connected')
                return false
            }

            this.ws.send(JSON.stringify({
                type: 'join',
                sessionId,
                token,
                password,
            }))

            return true
        } catch (error) {
            this.logger.error('Failed to join session:', error)
            return false
        }
    }

    /**
     * Broadcast terminal output to viewers
     */
    broadcastOutput (sessionId: string, data: Buffer): void {
        const sharedSession = this.sharedSessions.get(sessionId)
        if (!sharedSession) {
            return
        }

        // Broadcast via IPC (if in Electron) or direct WebSocket
        try {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                ipcRenderer.send('session-sharing:broadcast-output', sessionId, data)
            } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'output',
                    sessionId: sharedSession.id,
                    data: data.toString('base64'),
                }))
            }
        } catch (error) {
            this.logger.debug('Failed to broadcast output:', error)
        }
    }

    /**
     * Forward input from viewer to terminal (for interactive mode)
     */
    forwardInput (sessionId: string, data: Buffer): void {
        const sharedSession = this.sharedSessions.get(sessionId)
        if (!sharedSession || sharedSession.mode !== 'interactive') {
            return
        }

        // Forward via IPC (if in Electron) or direct WebSocket
        try {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                ipcRenderer.send('session-sharing:forward-input', sessionId, data)
            } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'input',
                    sessionId: sharedSession.id,
                    data: data.toString('base64'),
                }))
            }
        } catch (error) {
            this.logger.debug('Failed to forward input:', error)
        }
    }

    /**
     * Connect to WebSocket server
     */
    private async connectWebSocket (): Promise<void> {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return
        }

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl)

                this.ws.onopen = () => {
                    this.logger.info('WebSocket connected')
                    resolve()
                }

                this.ws.onerror = (error) => {
                    this.logger.error('WebSocket error:', error)
                    // For now, fail silently - in production, would show notification
                    reject(error)
                }

                this.ws.onclose = () => {
                    this.logger.info('WebSocket closed')
                    this.ws = null
                }

                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data)
                        this.handleWebSocketMessage(message)
                    } catch (error) {
                        this.logger.error('Failed to parse WebSocket message:', error)
                    }
                }
            } catch (error) {
                this.logger.error('Failed to create WebSocket:', error)
                reject(error)
            }
        })
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleWebSocketMessage (message: any): void {
        switch (message.type) {
            case 'viewer-joined':
                this.handleViewerJoined(message)
                break
            case 'viewer-left':
                this.handleViewerLeft(message)
                break
            case 'input':
                this.handleViewerInput(message)
                break
            default:
                this.logger.warn('Unknown WebSocket message type:', message.type)
        }
    }

    private handleViewerJoined (message: any): void {
        const sharedSession = this.sharedSessions.get(message.sessionId)
        if (sharedSession) {
            sharedSession.viewers++
            this.logger.info('Viewer joined:', message.sessionId, 'Total viewers:', sharedSession.viewers)
        }
    }

    private handleViewerLeft (message: any): void {
        const sharedSession = this.sharedSessions.get(message.sessionId)
        if (sharedSession && sharedSession.viewers > 0) {
            sharedSession.viewers--
            this.logger.info('Viewer left:', message.sessionId, 'Total viewers:', sharedSession.viewers)
        }
    }

    private handleViewerInput (message: any): void {
        // This will be handled by the decorator
        // For now, just log it
        this.logger.debug('Viewer input received:', message.sessionId)
    }

    /**
     * Get base URL for shareable links
     */
    private async getBaseUrl (): Promise<string> {
        // Try to get WebSocket server URL from embedded server (if in Electron)
        try {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer && ipcRenderer.invoke) {
                // Try to get public URL first (if tunnel is active)
                const publicUrl = await ipcRenderer.invoke('session-sharing:get-public-url')
                if (publicUrl) {
                    return publicUrl.replace('ws://', 'tlink://share/').replace('/session', '')
                }
                
                // Fallback to local URL
                const localUrl = await ipcRenderer.invoke('session-sharing:get-server-url', false)
                return localUrl.replace('ws://', 'tlink://share/').replace('/session', '')
            }
        } catch (error) {
            // Fallback to placeholder
            this.logger.debug('Could not get server URL from IPC:', error)
        }
        return 'tlink://share'
    }

    /**
     * Get shareable URL with network access information
     */
    async getShareableUrlWithInfo (terminal: BaseTerminalTabComponent<any>): Promise<{ url: string, networkUrl?: string, publicUrl?: string } | null> {
        const sharedSession = this.getSharedSession(terminal)
        if (!sharedSession) {
            return null
        }

        const baseUrl = await this.getBaseUrl()
        const shareUrl = `${baseUrl}/session/${sharedSession.id}${sharedSession.token.substring(0, 8)}`
        
        const result: { url: string, networkUrl?: string, publicUrl?: string } = { url: shareUrl }

        try {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                // Get network URL template
                const networkUrlTemplate = await ipcRenderer.invoke('session-sharing:get-network-url')
                result.networkUrl = networkUrlTemplate

                // Get public URL if available
                const publicUrl = await ipcRenderer.invoke('session-sharing:get-public-url')
                if (publicUrl) {
                    result.publicUrl = publicUrl.replace('ws://', 'tlink://share/').replace('/session', '')
                }
            }
        } catch (error) {
            this.logger.debug('Could not get network/public URL info:', error)
        }

        return result
    }

    /**
     * Get IPC renderer if available (in Electron)
     */
    private getIpcRenderer (): any {
        try {
            // Check if we're in Electron renderer process
            if (typeof window !== 'undefined' && (window as any).require) {
                const electron = (window as any).require('electron')
                if (electron && electron.ipcRenderer) {
                    return electron.ipcRenderer
                }
            }
            // Also try require if available (Node.js environment)
            if (typeof require !== 'undefined') {
                try {
                    const electron = require('electron')
                    if (electron && electron.ipcRenderer) {
                        return electron.ipcRenderer
                    }
                } catch {
                    // Not in Electron
                }
            }
        } catch {
            // IPC not available
        }
        return null
    }
}

