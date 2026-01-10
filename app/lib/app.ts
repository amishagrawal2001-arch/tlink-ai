import { app, ipcMain, Menu, Tray, shell, screen, globalShortcut, MenuItemConstructorOptions, WebContents, nativeImage } from 'electron'
import promiseIpc from 'electron-promise-ipc'
import * as remote from '@electron/remote/main'
import { exec } from 'mz/child_process'
import * as path from 'path'
import * as fs from 'fs'
import { Subject, throttleTime } from 'rxjs'

import { saveConfig } from './config'
import { Window, WindowOptions } from './window'
import { pluginManager } from './pluginManager'
import { PTYManager } from './pty'
import { getSessionSharingServer } from './sessionSharingServer'

/* eslint-disable block-scoped-var */

try {
    var wnr = require('windows-native-registry') // eslint-disable-line @typescript-eslint/no-var-requires, no-var
} catch (_) { }

export class Application {
    private tray?: Tray
    private ptyManager = new PTYManager()
    private sessionSharingServer = getSessionSharingServer()
    private windows: Window[] = []
    private globalHotkey$ = new Subject<void>()
    private quitRequested = false
    userPluginsPath: string

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    constructor (private configStore: any) {
        remote.initialize()
        this.useBuiltinGraphics()
        this.ptyManager.init(this)
        this.initSessionSharing()

        ipcMain.handle('app:save-config', async (event, config) => {
            await saveConfig(config)
            this.broadcastExcept('host:config-change', event.sender, config)
        })

        ipcMain.on('app:register-global-hotkey', (_event, specs) => {
            globalShortcut.unregisterAll()
            for (const spec of specs) {
                globalShortcut.register(spec, () => this.globalHotkey$.next())
            }
        })

        this.globalHotkey$.pipe(throttleTime(100)).subscribe(() => {
            this.onGlobalHotkey()
        })

        ;(promiseIpc as any).on('plugin-manager:install', (name, version) => {
            return pluginManager.install(this.userPluginsPath, name, version)
        })

        ;(promiseIpc as any).on('plugin-manager:uninstall', (name) => {
            return pluginManager.uninstall(this.userPluginsPath, name)
        })

        ;(promiseIpc as any).on('get-default-mac-shell', async () => {
            try {
                return (await exec(`/usr/bin/dscl . -read /Users/${process.env.LOGNAME} UserShell`))[0].toString().split(' ')[1].trim()
            } catch {
                return '/bin/bash'
            }
        })

        if (process.platform === 'linux') {
            app.commandLine.appendSwitch('no-sandbox')
            if ((this.configStore.appearance?.opacity || 1) !== 1) {
                app.commandLine.appendSwitch('enable-transparent-visuals')
                app.disableHardwareAcceleration()
            }
        }
        if (this.configStore.hacks?.disableGPU) {
            app.commandLine.appendSwitch('disable-gpu')
            app.disableHardwareAcceleration()
        }

        this.userPluginsPath = path.join(
            app.getPath('userData'),
            'plugins',
        )

        if (!fs.existsSync(this.userPluginsPath)) {
            fs.mkdirSync(this.userPluginsPath)
        }

        app.commandLine.appendSwitch('disable-http-cache')
        app.commandLine.appendSwitch('max-active-webgl-contexts', '9000')
        app.commandLine.appendSwitch('lang', 'EN')

        for (const flag of this.configStore.flags || [['force_discrete_gpu', '0']]) {
            app.commandLine.appendSwitch(flag[0], flag[1])
        }

        app.on('before-quit', () => {
            this.sessionSharingServer.stop()
            this.quitRequested = true
        })

        app.on('window-all-closed', () => {
            if (this.quitRequested || process.platform !== 'darwin') {
                app.quit()
            }
        })
    }

    /**
     * Initialize session sharing server and IPC handlers
     */
    private initSessionSharing (): void {
        // IPC handler: Get WebSocket server URL
        ipcMain.handle('session-sharing:get-server-url', async (_event, usePublicUrl: boolean = false) => {
            return this.sessionSharingServer.getWebSocketUrl(usePublicUrl)
        })

        // IPC handler: Register a shared session
        ipcMain.handle('session-sharing:register', async (_event, sessionId: string, token: string, mode: string, password?: string, expiresIn?: number) => {
            this.sessionSharingServer.registerSession(sessionId, token, mode as 'read-only' | 'interactive', password, expiresIn)
        })

        // IPC handler: Unregister a shared session
        ipcMain.handle('session-sharing:unregister', async (_event, sessionId: string) => {
            this.sessionSharingServer.unregisterSession(sessionId)
        })

        // IPC handler: Broadcast terminal output
        ipcMain.on('session-sharing:broadcast-output', (_event, sessionId: string, data: Buffer) => {
            this.sessionSharingServer.broadcastOutput(sessionId, Buffer.from(data))
        })

        // IPC handler: Forward input from viewer (interactive mode)
        ipcMain.on('session-sharing:forward-input', (_event, sessionId: string, data: Buffer) => {
            // Note: We'll need to get the terminal instance to write input
            // For now, emit an event that can be handled
            this.broadcast('session-sharing:terminal-input', sessionId, Buffer.from(data))
        })

        // IPC handler: Get viewer count
        ipcMain.handle('session-sharing:get-viewer-count', async (_event, sessionId: string) => {
            return this.sessionSharingServer.getViewerCount(sessionId)
        })

        // IPC handler: Get server status
        ipcMain.handle('session-sharing:get-server-status', async () => {
            return {
                isRunning: this.sessionSharingServer.isStarted(),
                port: this.sessionSharingServer.getPort(),
                host: this.sessionSharingServer.getHost(),
                url: this.sessionSharingServer.getWebSocketUrl(false),
                publicUrl: this.sessionSharingServer.getPublicUrl(),
                activeSessions: this.sessionSharingServer.getActiveSessionCount(),
            }
        })

        // IPC handler: Check if server is running
        ipcMain.handle('session-sharing:is-server-running', async () => {
            return this.sessionSharingServer.isStarted()
        })

        // IPC handler: Start server
        ipcMain.handle('session-sharing:start-server', async (_event, port?: number, host?: string) => {
            try {
                const sessionSharingConfig = this.configStore.sessionSharing || {}
                const bindHost = host || sessionSharingConfig.bindHost || '0.0.0.0'
                const bindPort = port || sessionSharingConfig.port || 0
                const actualPort = await this.sessionSharingServer.start(bindPort, bindHost)
                // Broadcast status change
                this.broadcast('session-sharing:server-status-changed', {
                    isRunning: true,
                    port: actualPort,
                    host: bindHost,
                    url: this.sessionSharingServer.getWebSocketUrl(false),
                    publicUrl: this.sessionSharingServer.getPublicUrl(),
                })
                return { success: true, port: actualPort, host: bindHost }
            } catch (error: any) {
                console.error('Failed to start session sharing server:', error)
                return { success: false, error: error.message }
            }
        })

        // IPC handler: Stop server
        ipcMain.handle('session-sharing:stop-server', async () => {
            try {
                await this.sessionSharingServer.stop()
                // Broadcast status change
                this.broadcast('session-sharing:server-status-changed', {
                    isRunning: false,
                    port: 0,
                    host: '0.0.0.0',
                    url: null,
                    publicUrl: null,
                })
                return { success: true }
            } catch (error: any) {
                console.error('Failed to stop session sharing server:', error)
                return { success: false, error: error.message }
            }
        })

        // IPC handler: Set public URL (for tunneling services)
        ipcMain.handle('session-sharing:set-public-url', async (_event, url: string | null) => {
            this.sessionSharingServer.setPublicUrl(url)
            // Broadcast status change
            this.broadcast('session-sharing:server-status-changed', {
                isRunning: this.sessionSharingServer.isStarted(),
                port: this.sessionSharingServer.getPort(),
                host: this.sessionSharingServer.getHost(),
                url: this.sessionSharingServer.getWebSocketUrl(false),
                publicUrl: this.sessionSharingServer.getPublicUrl(),
            })
        })

        // IPC handler: Get network URL template
        ipcMain.handle('session-sharing:get-network-url', async () => {
            return this.sessionSharingServer.getNetworkUrl()
        })

        // IPC handler: Get public URL if available
        ipcMain.handle('session-sharing:get-public-url', async () => {
            return this.sessionSharingServer.getPublicUrl()
        })

        // Listen for viewer join/leave events from server
        process.on('session-sharing:viewer-joined' as any, (sessionId: string, count: number) => {
            this.broadcast('session-sharing:viewer-count-changed', sessionId, count)
        })

        process.on('session-sharing:viewer-left' as any, (sessionId: string, count: number) => {
            this.broadcast('session-sharing:viewer-count-changed', sessionId, count)
        })

        // Listen for input events from server (will need to route to terminal)
        process.on('session-sharing:input' as any, (sessionId: string, data: Buffer) => {
            this.broadcast('session-sharing:terminal-input', sessionId, data)
        })

    }

    /**
     * Start tunneling service for internet access (optional)
     * This can be integrated with services like ngrok, localtunnel, or Cloudflare Tunnel
     */
    private async startTunnelingService (): Promise<void> {
        // TODO: Implement tunneling service integration
        // Options:
        // 1. ngrok - requires ngrok binary or API key
        // 2. localtunnel - npm package, simple to use
        // 3. Cloudflare Tunnel - free, requires cloudflare account
        // 4. Custom tunnel service
        
        console.log('Tunneling service requested but not yet implemented')
        console.log('For internet access, consider:')
        console.log('  1. Using port forwarding on your router')
        console.log('  2. Using a tunneling service (ngrok, localtunnel, etc.)')
        console.log('  3. Using a VPN to connect to your local network')
        
        // For now, users can manually set up port forwarding or use external tunneling tools
    }

    async init (): Promise<void> {
        // Don't auto-start the server - let user control it via the dock button
        // Server will start when:
        // 1. User clicks the dock button to start it
        // 2. User tries to share a session and agrees to start it
        
        // Check if auto-start is enabled in config (for backward compatibility)
        const sessionSharingConfig = this.configStore.sessionSharing || {}
        if (sessionSharingConfig.autoStart) {
            try {
                const bindHost = sessionSharingConfig.bindHost || '0.0.0.0'
                const port = sessionSharingConfig.port || 0
                await this.sessionSharingServer.start(port, bindHost)
                
                // If tunneling is enabled, start tunnel service (for internet access)
                if (sessionSharingConfig.enableTunneling) {
                    await this.startTunnelingService()
                }
            } catch (error) {
                console.warn('Failed to auto-start session sharing server:', error)
            }
        }

        screen.on('display-metrics-changed', () => this.broadcast('host:display-metrics-changed'))
        screen.on('display-added', () => this.broadcast('host:displays-changed'))
        screen.on('display-removed', () => this.broadcast('host:displays-changed'))
    }

    async newWindow (options?: WindowOptions): Promise<Window> {
        const window = new Window(this, this.configStore, options)
        this.windows.push(window)
        if (this.windows.length === 1) {
            window.makeMain()
        }
        window.visible$.subscribe(visible => {
            if (visible) {
                this.disableTray()
            } else {
                this.enableTray()
            }
        })
        window.closed$.subscribe(() => {
            this.windows = this.windows.filter(x => x !== window)
            if (!this.windows.some(x => x.isMainWindow)) {
                this.windows[0]?.makeMain()
                this.windows[0]?.present()
            }
        })
        if (process.platform === 'darwin') {
            this.setupMenu()
        }
        await window.ready
        return window
    }

    onGlobalHotkey (): void {
        let isPresent = this.windows.some(x => x.isFocused() && x.isVisible())
        const isDockedOnTop = this.windows.some(x => x.isDockedOnTop())
        if (isDockedOnTop) {
            // if docked and on top, hide even if not focused right now
            isPresent = this.windows.some(x => x.isVisible())
        }

        if (isPresent) {
            for (const window of this.windows) {
                window.hide()
            }
        } else {
            for (const window of this.windows) {
                window.present()
            }
        }
    }

    presentAllWindows (): void {
        for (const window of this.windows) {
            window.present()
        }
    }

    broadcast (event: string, ...args: any[]): void {
        for (const window of this.windows) {
            window.send(event, ...args)
        }
    }

    broadcastExcept (event: string, except: WebContents, ...args: any[]): void {
        for (const window of this.windows) {
            if (window.webContents.id !== except.id) {
                window.send(event, ...args)
            }
        }
    }

    async send (event: string, ...args: any[]): Promise<void> {
        if (!this.hasWindows()) {
            await this.newWindow()
        }
        this.windows.filter(w => !w.isDestroyed())[0].send(event, ...args)
    }

    enableTray (): void {
        if (!!this.tray || process.platform === 'linux' || (this.configStore.hideTray ?? false) === true) {
            return
        }

        const customTrayPath = path.join(app.getAppPath(), '..', 'build', 'icons', 'Tlink-logo.png')
        const customTrayIcon = nativeImage.createFromPath(customTrayPath)
        const hasCustomTrayIcon = !customTrayIcon.isEmpty()

        if (process.platform === 'darwin') {
            if (hasCustomTrayIcon) {
                this.tray = new Tray(customTrayIcon)
            } else {
                this.tray = new Tray(`${app.getAppPath()}/assets/tray-darwinTemplate.png`)
                this.tray.setPressedImage(`${app.getAppPath()}/assets/tray-darwinHighlightTemplate.png`)
            }
        } else {
            this.tray = new Tray(hasCustomTrayIcon ? customTrayIcon : `${app.getAppPath()}/assets/tray.png`)
        }

        this.tray.on('click', () => setTimeout(() => this.focus()))

        const contextMenu = Menu.buildFromTemplate([{
            label: 'Show',
            click: () => this.focus(),
        }])

        if (process.platform !== 'darwin') {
            this.tray.setContextMenu(contextMenu)
        }

        this.tray.setToolTip(`${app.getName()} ${app.getVersion()}`)
    }

    disableTray (): void {
        if (process.platform === 'linux') {
            return
        }
        this.tray?.destroy()
        this.tray = null
    }

    hasWindows (): boolean {
        return !!this.windows.length
    }

    focus (): void {
        for (const window of this.windows) {
            window.present()
        }
    }

    async handleSecondInstance (argv: string[], cwd: string): Promise<void> {
        if (!this.windows.length) {
            await this.newWindow()
        }
        this.presentAllWindows()
        this.windows[this.windows.length - 1].passCliArguments(argv, cwd, true)
    }

    private useBuiltinGraphics (): void {
        if (process.platform === 'win32') {
            const keyPath = 'SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences'
            const valueName = app.getPath('exe')
            if (!wnr.getRegistryValue(wnr.HK.CU, keyPath, valueName)) {
                wnr.setRegistryValue(wnr.HK.CU, keyPath, valueName, wnr.REG.SZ, 'GpuPreference=1;')
            }
        }
    }

    private setupMenu () {
        const template: MenuItemConstructorOptions[] = [
            {
                label: 'Application',
                submenu: [
                    { role: 'about', label: `About ${app.getName()}` },
                    { type: 'separator' },
                    {
                        label: 'Preferences',
                        accelerator: 'Cmd+,',
                        click: async () => {
                            if (!this.hasWindows()) {
                                await this.newWindow()
                            }
                            this.windows[0].send('host:preferences-menu')
                        },
                    },
                    { type: 'separator' },
                    { role: 'services', submenu: [] },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    {
                        label: 'Quit',
                        accelerator: 'Cmd+Q',
                        click: () => {
                            this.quitRequested = true
                            app.quit()
                        },
                    },
                ],
            },
            {
                label: 'Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' },
                ],
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Command Window',
                        click: async () => {
                            if (!this.hasWindows()) {
                                await this.newWindow()
                            }
                            const target = this.windows.find(window => window.isFocused()) ?? this.windows[0]
                            target?.send('host:command-window')
                        },
                    },
                    {
                        label: 'Command Window (Bottom)',
                        click: async () => {
                            if (!this.hasWindows()) {
                                await this.newWindow()
                            }
                            const target = this.windows.find(window => window.isFocused()) ?? this.windows[0]
                            target?.send('host:command-window-bottom')
                        },
                    },
                    {
                        label: 'Button Bar',
                        click: async () => {
                            if (!this.hasWindows()) {
                                await this.newWindow()
                            }
                            const target = this.windows.find(window => window.isFocused()) ?? this.windows[0]
                            target?.send('host:button-bar')
                        },
                    },
                    {
                        label: 'Session Manager',
                        click: async () => {
                            if (!this.hasWindows()) {
                                await this.newWindow()
                            }
                            const target = this.windows.find(window => window.isFocused()) ?? this.windows[0]
                            target?.send('host:session-manager')
                        },
                    },
                    { type: 'separator' },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' },
                ],
            },
            {
                role: 'window',
                submenu: [
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front' },
                ],
            },
            {
                role: 'help',
                submenu: [
                    {
                        label: 'Website',
                        click () {
                            shell.openExternal('https://eugeny.github.io/tlink')
                        },
                    },
                ],
            },
        ]

        if (process.env.TLINK_DEV) {
            template[2].submenu['unshift']({ role: 'reload' })
        }

        Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }
}
