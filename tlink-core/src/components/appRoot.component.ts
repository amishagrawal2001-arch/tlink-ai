/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, HostListener, HostBinding, ViewChildren, ViewChild, Type, OnInit } from '@angular/core'
import { trigger, style, animate, transition, state } from '@angular/animations'
import { NgbDropdown, NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop'
import * as Color from 'color'

import { HostAppService, Platform } from '../api/hostApp'
import { HotkeysService } from '../services/hotkeys.service'
import { TranslateService } from '@ngx-translate/core'
import { Logger, LogService } from '../services/log.service'
import { ConfigService } from '../services/config.service'
import { ThemesService } from '../services/themes.service'
import { UpdaterService } from '../services/updater.service'
import { CommandService } from '../services/commands.service'

import { BaseTabComponent } from './baseTab.component'
import { SafeModeModalComponent } from './safeModeModal.component'
import { ColorPickerModalComponent } from './colorPickerModal.component'
import { TabBodyComponent } from './tabBody.component'
import { SplitTabComponent } from './splitTab.component'
import { AppService, BottomPanelRegistration, BottomPanelService, Command, CommandContext, CommandLocation, FileTransfer, HostWindowService, PlatformService, SidePanelRegistration, SidePanelService } from '../api'
import { TabsService } from '../services/tabs.service'
import { CodeEditorTabComponent } from './codeEditorTab.component'

type SplitDirection = 'r' | 'l' | 't' | 'b'

function makeTabAnimation (dimension: string, size: number) {
    return [
        state('in', style({
            'flex-basis': '{{size}}',
            [dimension]: '{{size}}',
        }), {
            params: { size: `${size}px` },
        }),
        transition(':enter', [
            style({
                'flex-basis': '1px',
                [dimension]: '1px',
            }),
            animate('250ms ease-out', style({
                'flex-basis': '{{size}}',
                [dimension]: '{{size}}',
            })),
        ]),
        transition(':leave', [
            style({
                'flex-basis': 'auto',
                'padding-left': '*',
                'padding-right': '*',
                [dimension]: '*',
            }),
            animate('250ms ease-in-out', style({
                'padding-left': 0,
                'padding-right': 0,
                [dimension]: '0',
            })),
        ]),
    ]
}

/** @hidden */
@Component({
    selector: 'app-root',
    templateUrl: './appRoot.component.pug',
    styleUrls: ['./appRoot.component.scss'],
    animations: [
        trigger('animateTab', makeTabAnimation('width', 200)),
    ],
})
export class AppRootComponent implements OnInit {
    Platform = Platform
    @Input() ready = false
    @Input() leftToolbarButtons: Command[]
    @Input() rightToolbarButtons: Command[]
    @HostBinding('class.platform-win32') platformClassWindows = process.platform === 'win32'
    @HostBinding('class.platform-darwin') platformClassMacOS = process.platform === 'darwin'
    @HostBinding('class.platform-linux') platformClassLinux = process.platform === 'linux'
    @HostBinding('class.no-tabs') noTabs = true
    @ViewChildren(TabBodyComponent) tabBodies: TabBodyComponent[]
    @ViewChild('activeTransfersDropdown') activeTransfersDropdown: NgbDropdown
    unsortedTabs: BaseTabComponent[] = []
    updatesAvailable = false
    activeTransfers: FileTransfer[] = []
    transfersFloating = window.localStorage['transfersFloating'] === '1'
    sidePanelVisible = false
    sidePanelComponent: Type<any> | null = null
    sidePanelWidth = 320
    sidePanelId = ''
    sidePanels: SidePanelRegistration[] = []
    bottomPanelVisible = false
    bottomPanelComponent: Type<any> | null = null
    bottomPanelHeight = 0
    bottomPanelId = ''
    bottomPanelInputs: Record<string, any> = {}
    bottomPanels: BottomPanelRegistration[] = []
    private bottomPanelResizing = false
    private bottomPanelResizeStartY = 0
    private bottomPanelResizeStartHeight = 0
    private sidePanelColorPickerOpen = false
    private logger: Logger

    constructor (
        private hotkeys: HotkeysService,
        private commands: CommandService,
        public updater: UpdaterService,
        public hostWindow: HostWindowService,
        public hostApp: HostAppService,
        public config: ConfigService,
        public app: AppService,
        private translate: TranslateService,
        private tabsService: TabsService,
        private sidePanel: SidePanelService,
        private bottomPanel: BottomPanelService,
        private platform: PlatformService,
        log: LogService,
        private ngbModal: NgbModal,
        _themes: ThemesService,
    ) {
        // document.querySelector('app-root')?.remove()
        this.logger = log.create('main')
        this.logger.info('v', platform.getAppVersion())

        this.hotkeys.hotkey$.subscribe((hotkey: string) => {
            if (hotkey.startsWith('tab-')) {
                const index = parseInt(hotkey.split('-')[1])
                if (index <= this.app.tabs.length) {
                    this.app.selectTab(this.app.tabs[index - 1])
                }
            }
            if (this.app.activeTab) {
                if (hotkey === 'close-tab') {
                    this.app.closeTab(this.app.activeTab, true)
                }
                if (hotkey === 'toggle-last-tab') {
                    this.app.toggleLastTab()
                }
                if (hotkey === 'next-tab') {
                    this.app.nextTab()
                }
                if (hotkey === 'previous-tab') {
                    this.app.previousTab()
                }
                if (hotkey === 'move-tab-left') {
                    this.app.moveSelectedTabLeft()
                }
                if (hotkey === 'move-tab-right') {
                    this.app.moveSelectedTabRight()
                }
                if (hotkey === 'duplicate-tab') {
                    this.app.duplicateTab(this.app.activeTab)
                }
                if (hotkey === 'restart-tab') {
                    this.app.duplicateTab(this.app.activeTab)
                    this.app.closeTab(this.app.activeTab, true)
                }
                if (hotkey === 'explode-tab' && this.app.activeTab instanceof SplitTabComponent) {
                    this.app.explodeTab(this.app.activeTab)
                }
                if (hotkey === 'combine-tabs' && this.app.activeTab instanceof SplitTabComponent) {
                    this.app.combineTabsInto(this.app.activeTab)
                }
            }
            if (hotkey === 'reopen-tab') {
                this.app.reopenLastTab()
            }
            if (hotkey === 'toggle-fullscreen') {
                hostWindow.toggleFullscreen()
            }
            if (hotkey === 'cycle-color-scheme') {
                this.cycleColorSchemeMode()
            }
        })

        this.hostWindow.windowCloseRequest$.subscribe(async () => {
            this.app.closeWindow()
        })

        if (window['safeModeReason']) {
            this.ngbModal.open(SafeModeModalComponent)
        }

        this.app.tabOpened$.subscribe(tab => {
            this.unsortedTabs.push(tab)
            this.noTabs = false
            this.app.emitTabDragEnded()
        })

        this.app.tabRemoved$.subscribe(tab => {
            for (const tabBody of this.tabBodies) {
                if (tabBody.tab === tab) {
                    tabBody.detach()
                }
            }
            this.unsortedTabs = this.unsortedTabs.filter(x => x !== tab)
            this.noTabs = app.tabs.length === 0
            this.app.emitTabDragEnded()
        })

        platform.fileTransferStarted$.subscribe(transfer => {
            this.activeTransfers.push(transfer)
            this.activeTransfersDropdown.open()
        })

        this.sidePanel.state$.subscribe(state => {
            this.sidePanelVisible = state.visible
            this.sidePanelComponent = state.component
            this.sidePanelWidth = state.width
            this.sidePanelId = state.id
        })
        this.sidePanel.panels$.subscribe(panels => {
            this.sidePanels = panels.slice().sort((a, b) => a.label.localeCompare(b.label))
        })
        this.bottomPanel.state$.subscribe(state => {
            this.bottomPanelVisible = state.visible
            this.bottomPanelComponent = state.component
            this.bottomPanelHeight = state.height
            this.bottomPanelId = state.id
            this.bottomPanelInputs = state.inputs ?? {}
        })
        this.bottomPanel.panels$.subscribe(panels => {
            this.bottomPanels = panels
        })

        config.ready$.toPromise().then(async () => {
            this.leftToolbarButtons = await this.getToolbarButtons(false)
            this.rightToolbarButtons = await this.getToolbarButtons(true)

            setInterval(() => {
                if (this.config.store.enableAutomaticUpdates) {
                    this.updater.check().then(available => {
                        this.updatesAvailable = available
                    })
                }
            }, 3600 * 12 * 1000)
        })
    }

    get canSplitShortcut (): boolean {
        return !!this.app.activeTab
    }

    get canOpenCommandWindow (): boolean {
        return this.bottomPanels.some(panel => panel.id === 'command-window')
    }

    get isCommandWindowOpen (): boolean {
        return this.bottomPanelVisible && this.bottomPanelId === 'command-window'
    }

    openSettingsFromDock (): void {
        this.hostApp.openSettingsUI()
    }

    cycleColorSchemeFromDock (): void {
        this.cycleColorSchemeMode()
    }

    get shouldShowBottomPanel (): boolean {
        if (!this.bottomPanelVisible || !this.bottomPanelComponent) {
            return false
        }
        if (this.bottomPanelId === 'command-window' && this.isChatTabActive) {
            return false
        }
        return true
    }

    toggleCommandWindowBottom (): void {
        const panel = this.bottomPanels.find(p => p.id === 'command-window')
        if (!panel) {
            return
        }
        this.bottomPanel.toggle(panel)
    }

    get isChatTabActive (): boolean {
        const active = this.getActiveLeafTab()
        return (active?.constructor?.name ?? '') === 'ChatTabComponent'
    }

    async splitActiveTabShortcut (direction: SplitDirection = 'r'): Promise<void> {
        const active = this.app.activeTab
        if (!active) {
            return
        }
        if (active instanceof CodeEditorTabComponent) {
            active.toggleSplitView()
            return
        }
        if (active instanceof SplitTabComponent) {
            const focused = active.getFocusedTab()
            if (focused instanceof CodeEditorTabComponent) {
                focused.toggleSplitView()
                return
            }
        }

        if (active instanceof SplitTabComponent) {
            const focused = active.getFocusedTab()
            if (!focused) {
                return
            }
            const created = await active.splitTab(focused, direction)
            if (created) {
                active.focus(created)
            }
            return
        }

        const parentSplit = this.app.getParentTab(active)
        if (parentSplit) {
            const created = await parentSplit.splitTab(active, direction)
            if (created) {
                parentSplit.focus(created)
            }
            return
        }

        const duplicate = await this.tabsService.duplicate(active)
        const split = this.tabsService.create({ type: SplitTabComponent })
        const tabIndex = this.app.tabs.indexOf(active)
        const unsortedIndex = this.unsortedTabs.indexOf(active)

        this.app.addTabRaw(split, tabIndex === -1 ? null : tabIndex)

        await split.addTab(active, null, direction)
        if (duplicate) {
            await split.addTab(duplicate, active, direction)
        }

        const activeIndex = this.app.tabs.indexOf(active)
        if (activeIndex !== -1) {
            this.app.tabs.splice(activeIndex, 1)
        }
        if (unsortedIndex !== -1) {
            this.unsortedTabs.splice(unsortedIndex, 1)
            const splitIndex = this.unsortedTabs.indexOf(split)
            if (splitIndex !== -1 && splitIndex !== unsortedIndex) {
                this.unsortedTabs.splice(unsortedIndex, 0, this.unsortedTabs.splice(splitIndex, 1)[0])
            }
        }
        this.app.emitTabsChanged()
        split.focus(duplicate ?? active)
    }

    openSplitShortcutMenu (event: MouseEvent): void {
        if (!this.canSplitShortcut) {
            return
        }

        event.preventDefault()
        event.stopPropagation()

        const items = [
            {
                label: this.translate.instant('Split right'),
                click: () => { void this.splitActiveTabShortcut('r') },
            },
            {
                label: this.translate.instant('Split left'),
                click: () => { void this.splitActiveTabShortcut('l') },
            },
            {
                label: this.translate.instant('Split down'),
                click: () => { void this.splitActiveTabShortcut('b') },
            },
            {
                label: this.translate.instant('Split up'),
                click: () => { void this.splitActiveTabShortcut('t') },
            },
        ]

        this.platform.popupContextMenu(items, event)
    }

    onBottomResizeStart (event: MouseEvent | TouchEvent): void {
        event.preventDefault()
        event.stopPropagation()
        const clientY = event instanceof TouchEvent ? event.touches[0].clientY : event.clientY
        this.bottomPanelResizing = true
        this.bottomPanelResizeStartY = clientY
        this.bottomPanelResizeStartHeight = this.bottomPanelHeight
    }

    @HostListener('window:mousemove', ['$event'])
    onBottomResizeMove (event: MouseEvent): void {
        if (!this.bottomPanelResizing) {
            return
        }
        const delta = this.bottomPanelResizeStartY - event.clientY
        const next = this.clampBottomPanelHeight(this.bottomPanelResizeStartHeight + delta)
        this.bottomPanelHeight = next
        this.bottomPanel.setHeight(next)
    }

    @HostListener('window:mouseup')
    onBottomResizeEnd (): void {
        this.bottomPanelResizing = false
    }

    @HostListener('window:touchmove', ['$event'])
    onBottomResizeMoveTouch (event: TouchEvent): void {
        if (!this.bottomPanelResizing || !event.touches.length) {
            return
        }
        const delta = this.bottomPanelResizeStartY - event.touches[0].clientY
        const next = this.clampBottomPanelHeight(this.bottomPanelResizeStartHeight + delta)
        this.bottomPanelHeight = next
        this.bottomPanel.setHeight(next)
    }

    @HostListener('window:touchend')
    onBottomResizeEndTouch (): void {
        this.bottomPanelResizing = false
    }

    private clampBottomPanelHeight (value: number): number {
        const min = 160
        const max = Math.max(window.innerHeight - 120, min)
        return Math.min(Math.max(value, min), max)
    }

    private getActiveLeafTab (): BaseTabComponent | null {
        const active = this.app.activeTab
        if (!active) {
            return null
        }
        if (active instanceof SplitTabComponent) {
            return active.getFocusedTab() ?? active
        }
        return active
    }

    private cycleColorSchemeMode (): void {
        const order: Array<'auto'|'dark'|'light'> = ['auto', 'dark', 'light']
        const current = this.config.store.appearance.colorSchemeMode as 'auto'|'dark'|'light'|undefined
        const currentIndex = Math.max(0, order.indexOf(current ?? 'dark'))
        const next = order[(currentIndex + 1) % order.length]
        this.config.store.appearance.colorSchemeMode = next
        this.config.save()
    }

    async ngOnInit () {
        this.config.ready$.toPromise().then(() => {
            this.ready = true
            this.app.emitReady()
        })

        // Check initial WebSocket server status
        await this.checkWebSocketServerStatus()

        // Listen for server status changes from main process
        if (this.isElectron()) {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                ipcRenderer.on('session-sharing:server-status-changed', (_event: any, status: any) => {
                    this.websocketServerRunning = status.isRunning
                    this.websocketServerPort = status.port || 0
                })
            }
        }
    }

    @HostListener('dragover')
    onDragOver () {
        return false
    }

    @HostListener('drop')
    onDrop () {
        return false
    }

    hasVerticalTabs () {
        return this.config.store.appearance.tabsLocation === 'left' || this.config.store.appearance.tabsLocation === 'right'
    }

    get targetTabSize (): any {
        if (this.hasVerticalTabs()) {
            return '*'
        }
        return this.config.store.appearance.flexTabs ? '*' : '200px'
    }

    onTabsReordered (event: CdkDragDrop<BaseTabComponent[]>) {
        const tab: BaseTabComponent = event.item.data
        if (!this.app.tabs.includes(tab)) {
            if (tab.parent instanceof SplitTabComponent) {
                tab.parent.removeTab(tab)
                this.app.wrapAndAddTab(tab)
            }
        }
        moveItemInArray(this.app.tabs, event.previousIndex, event.currentIndex)
        this.app.emitTabsChanged()
    }

    onTransfersChange () {
        if (this.activeTransfers.length === 0) {
            this.activeTransfersDropdown.close()
        }
    }

    onTransfersFloatingChange (floating: boolean): void {
        this.transfersFloating = floating
        if (this.activeTransfers.length) {
            setTimeout(() => this.activeTransfersDropdown.open())
        }
    }

    @HostBinding('class.vibrant') get isVibrant () {
        return this.config.store?.appearance.vibrancy
    }

    private async getToolbarButtons (aboveZero: boolean): Promise<Command[]> {
        const buttons = (await this.commands.getCommands({ tab: this.app.activeTab ?? undefined }))
            .filter(x => x.locations?.includes(aboveZero ? CommandLocation.RightToolbar : CommandLocation.LeftToolbar))
        if (!aboveZero) {
            return buttons
        }
        const settingsLabel = this.translate.instant('Settings')
        return buttons.filter(button => button.id !== 'core:cycle-color-scheme' && button.label !== settingsLabel)
    }

    toggleMaximize (): void {
        this.hostWindow.toggleMaximize()
    }

    toggleSidePanel (panel: SidePanelRegistration): void {
        this.sidePanel.toggle(panel)
    }

    hasSidePanel (id: string): boolean {
        return this.sidePanels.some(p => p.id === id)
    }

    openSidePanelById (id: string): void {
        const panel = this.sidePanels.find(p => p.id === id)
        if (!panel) {
            return
        }
        if (this.sidePanelVisible && this.sidePanelId === id) {
            this.sidePanel.hide()
            return
        }
        this.sidePanel.show(panel)
    }

    openProfileSelector (): void {
        // Check if Settings tab is already open
        try {
            const { SettingsTabComponent } = window['nodeRequire']('tlink-settings')
            
            // Find existing Settings tab (could be top-level or in a split)
            let existingSettingsTab: any = null
            let parentSplit: SplitTabComponent | null = null
            
            for (const tab of this.app.tabs) {
                if (tab instanceof SettingsTabComponent) {
                    existingSettingsTab = tab
                    break
                } else if (tab instanceof SplitTabComponent) {
                    const settingsTab = tab.getAllTabs().find(t => t instanceof SettingsTabComponent)
                    if (settingsTab) {
                        existingSettingsTab = settingsTab
                        parentSplit = tab
                        break
                    }
                }
            }
            
            if (existingSettingsTab) {
                // Settings tab already exists, focus it and navigate to profiles section
                if (parentSplit) {
                    this.app.selectTab(parentSplit)
                    parentSplit.focus(existingSettingsTab)
                } else {
                    this.app.selectTab(existingSettingsTab)
                }
                // Set activeTab to profiles
                existingSettingsTab.activeTab = 'profiles'
            } else {
                // No Settings tab exists, open a new one
                this.app.openNewTabRaw({
                    type: SettingsTabComponent,
                    inputs: { activeTab: 'profiles' },
                })
            }
        } catch (err) {
            this.logger.error('Failed to open settings:', err)
        }
    }

    async openAIChat (): Promise<void> {
        const context: CommandContext = {}
        const tab = this.app.activeTab
        if (tab instanceof SplitTabComponent) {
            context.tab = tab.getFocusedTab() ?? undefined
        } else if (tab) {
            context.tab = tab
        }
        await this.commands.run('tlink-chatgpt:open', context)
    }

    websocketServerRunning = false
    websocketServerStarting = false
    websocketServerPort = 0

    private isElectron (): boolean {
        return typeof window !== 'undefined' && (window as any).require && typeof process !== 'undefined' && (process as any).type === 'renderer'
    }

    private getIpcRenderer (): any {
        try {
            if (this.isElectron()) {
                const electron = (window as any).require('electron')
                if (electron && electron.ipcRenderer) {
                    return electron.ipcRenderer
                }
            }
        } catch {
            // Not in Electron
        }
        return null
    }

    async checkWebSocketServerStatus (): Promise<void> {
        const ipcRenderer = this.getIpcRenderer()
        if (!ipcRenderer) {
            return
        }

        try {
            const status = await ipcRenderer.invoke('session-sharing:get-server-status')
            this.websocketServerRunning = status.isRunning
            this.websocketServerPort = status.port || 0
        } catch (error) {
            this.logger.debug('Could not check WebSocket server status:', error)
        }
    }

    async toggleWebSocketServer (): Promise<void> {
        if (this.websocketServerStarting) {
            return
        }

        const ipcRenderer = this.getIpcRenderer()
        if (!ipcRenderer) {
            return
        }

        this.websocketServerStarting = true

        try {
            if (this.websocketServerRunning) {
                // Stop server
                const result = await ipcRenderer.invoke('session-sharing:stop-server')
                if (result.success) {
                    this.logger.info('WebSocket server stopped')
                } else {
                    this.logger.error('Failed to stop WebSocket server:', result.error)
                    await this.platform.showMessageBox({
                        type: 'error',
                        message: 'Failed to stop WebSocket server',
                        detail: result.error,
                        buttons: ['OK'],
                    })
                }
            } else {
                // Start server
                const result = await ipcRenderer.invoke('session-sharing:start-server')
                if (result.success) {
                    this.logger.info(`WebSocket server started on port ${result.port}`)
                    this.websocketServerPort = result.port
                } else {
                    this.logger.error('Failed to start WebSocket server:', result.error)
                    await this.platform.showMessageBox({
                        type: 'error',
                        message: 'Failed to start WebSocket server',
                        detail: result.error,
                        buttons: ['OK'],
                    })
                }
            }
            
            // Refresh status
            await this.checkWebSocketServerStatus()
        } catch (error) {
            this.logger.error('Error toggling WebSocket server:', error)
            await this.platform.showMessageBox({
                type: 'error',
                message: 'Error controlling WebSocket server',
                detail: String(error),
                buttons: ['OK'],
            })
        } finally {
            this.websocketServerStarting = false
        }
    }

    openCodeEditor (): void {
        this.app.openNewTab({ type: CodeEditorTabComponent })
    }

    onSidePanelMouseUp (event: MouseEvent, panel: SidePanelRegistration): void {
        if (event.button !== 2) {
            return
        }
        void this.openSidePanelMenu(event, panel)
    }

    getSidePanelAccentRgb (panel: SidePanelRegistration): string|null {
        const color = this.getSidePanelColor(panel)
        if (!color) {
            return null
        }
        try {
            return Color(color).rgb().array().join(', ')
        } catch {
            return null
        }
    }

    async openSidePanelMenu (event: MouseEvent, panel: SidePanelRegistration): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        if (this.sidePanelColorPickerOpen) {
            return
        }
        this.sidePanelColorPickerOpen = true
        try {
            const currentColor = this.getSidePanelColor(panel)
            const defaultColor = this.getDefaultSidePanelColor()
            const modal = this.ngbModal.open(ColorPickerModalComponent)
            modal.componentInstance.title = panel.label
            modal.componentInstance.value = this.normalizeColorToHex(currentColor || defaultColor, defaultColor)
            modal.componentInstance.canReset = !!currentColor
            const result = await modal.result.catch(() => null)
            if (!result) {
                return
            }
            if (result.cleared) {
                this.setSidePanelColor(panel, null)
                return
            }
            const value = (result.value ?? '').trim()
            if (!value) {
                return
            }
            this.setSidePanelColor(panel, value)
        } finally {
            this.sidePanelColorPickerOpen = false
        }
    }

    private setSidePanelColor (panel: SidePanelRegistration, color: string|null): void {
        if (!this.config.store.appearance.sidePanelColors) {
            this.config.store.appearance.sidePanelColors = {}
        }
        if (color) {
            this.config.store.appearance.sidePanelColors[panel.id] = color
        } else {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this.config.store.appearance.sidePanelColors[panel.id]
        }
        this.config.save()
    }

    private getSidePanelColor (panel: SidePanelRegistration): string {
        return this.config.store?.appearance?.sidePanelColors?.[panel.id] ?? ''
    }

    private getDefaultSidePanelColor (): string {
        const cssValue = getComputedStyle(document.documentElement).getPropertyValue('--bs-primary').trim()
        return this.normalizeColorToHex(cssValue, '#3b82f6')
    }

    private normalizeColorToHex (value: string, fallback: string): string {
        if (!value) {
            return fallback
        }
        try {
            return Color(value).hex()
        } catch {
            return fallback
        }
    }

    protected isTitleBarNeeded (): boolean {
        return (
            this.config.store.appearance.frame === 'full'
            ||
                this.hostApp.platform !== Platform.macOS
                && this.config.store.appearance.frame === 'thin'
                && this.config.store.appearance.tabsLocation !== 'top'
                && this.config.store.appearance.tabsLocation !== 'bottom'
        )
    }
}
