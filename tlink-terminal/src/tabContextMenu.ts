import { Injectable, Optional, Inject } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseTabComponent as CoreBaseTabComponent, TabContextMenuItemProvider as CoreTabContextMenuItemProvider, NotificationsService, MenuItemOptions, TranslateService, SplitTabComponent, PromptModalComponent, ConfigService, PartialProfile, Profile, HostAppService, Platform, PlatformService, SessionSharingService, ShareSessionModalComponent, LogService, Logger, SelectorService, SelectorOption } from 'tlink-core'
import { BaseTerminalTabComponent } from './api/baseTerminalTab.component'
import { TerminalContextMenuItemProvider } from './api/contextMenuProvider'
import { MultifocusService } from './services/multifocus.service'
import { ConnectableTerminalTabComponent } from './api/connectableTerminalTab.component'
import { v4 as uuidv4 } from 'uuid'
import slugify from 'slugify'

// Fallback base classes to avoid runtime crashes if core exports are undefined
const TabContextMenuItemProviderRuntime = (CoreTabContextMenuItemProvider ?? class {}) as typeof CoreTabContextMenuItemProvider

/** @hidden */
@Injectable()
export class CopyPasteContextMenu extends TabContextMenuItemProviderRuntime {
    weight = -10

    constructor (
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    // Use `any` here to avoid type issues when the core base class is missing at runtime
    async getItems (tab: CoreBaseTabComponent, tabHeader?: boolean): Promise<MenuItemOptions[]> {
        if (tabHeader) {
            return []
        }
        if (tab instanceof BaseTerminalTabComponent) {
            return [
                {
                    label: this.translate.instant('Copy'),
                    click: (): void => {
                        setTimeout(() => {
                            tab.frontend?.copySelection()
                            this.notifications.notice(this.translate.instant('Copied'))
                        })
                    },
                },
                {
                    label: this.translate.instant('Paste'),
                    click: () => tab.paste(),
                },
            ]
        }
        return []
    }
}

/** @hidden */
@Injectable()
export class MiscContextMenu extends TabContextMenuItemProviderRuntime {
    weight = 1

    constructor (
        private translate: TranslateService,
        private multifocus: MultifocusService,
    ) { super() }

    async getItems (tab: CoreBaseTabComponent): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = []
        if (tab instanceof BaseTerminalTabComponent && tab.enableToolbar && !tab.pinToolbar) {
            items.push({
                label: this.translate.instant('Show toolbar'),
                click: () => {
                    tab.pinToolbar = true
                },
            })
        }
        if (tab instanceof BaseTerminalTabComponent && tab.session?.supportsWorkingDirectory()) {
            items.push({
                label: this.translate.instant('Copy current path'),
                click: () => tab.copyCurrentPath(),
            })
        }
        items.push({
            label: this.translate.instant('Focus all tabs'),
            click: () => {
                this.multifocus.focusAllTabs()
            },
        })
        if (tab.parent instanceof SplitTabComponent && tab.parent.getAllTabs().length > 1) {
            items.push({
                label: this.translate.instant('Focus all panes'),
                click: () => {
                    this.multifocus.focusAllPanes()
                },
            })
        }
        return items
    }
}

/** @hidden */
@Injectable()
export class ReconnectContextMenu extends TabContextMenuItemProviderRuntime {
    weight = 1

    constructor (
        private translate: TranslateService,
        private notifications: NotificationsService,
    ) { super() }

    async getItems (tab: CoreBaseTabComponent): Promise<MenuItemOptions[]> {
        if (tab instanceof ConnectableTerminalTabComponent) {
            return [
                {
                    label: this.translate.instant('Disconnect'),
                    click: (): void => {
                        setTimeout(() => {
                            tab.disconnect()
                            this.notifications.notice(this.translate.instant('Disconnect'))
                        })
                    },
                },
                {
                    label: this.translate.instant('Reconnect'),
                    click: (): void => {
                        setTimeout(() => {
                            tab.reconnect()
                            this.notifications.notice(this.translate.instant('Reconnect'))
                        })
                    },
                },
            ]
        }
        return []
    }

}

/** @hidden */
@Injectable()
export class LegacyContextMenu extends TabContextMenuItemProviderRuntime {
    weight = 1

    constructor (
        @Optional() @Inject(TerminalContextMenuItemProvider) protected contextMenuProviders: TerminalContextMenuItemProvider[]|null,
    ) {
        super()
    }

    async getItems (tab: CoreBaseTabComponent): Promise<MenuItemOptions[]> {
        if (!this.contextMenuProviders) {
            return []
        }
        if (tab instanceof BaseTerminalTabComponent) {
            let items: MenuItemOptions[] = []
            for (const p of this.contextMenuProviders) {
                items = items.concat(await p.getItems(tab))
            }
            return items
        }
        return []
    }

}

/** @hidden */
@Injectable()
export class SessionSharingContextMenu extends TabContextMenuItemProviderRuntime {
    weight = 0
    private logger: Logger

    constructor (
        private sessionSharing: SessionSharingService,
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private selector: SelectorService,
        log: LogService,
    ) {
        super()
        this.logger = log.create('sessionSharingContextMenu')
    }

    async getItems (tab: CoreBaseTabComponent): Promise<MenuItemOptions[]> {
        if (tab instanceof BaseTerminalTabComponent) {
            const isShared = this.sessionSharing.isSessionShared(tab)
            const sharedSession = this.sessionSharing.getSharedSession(tab)

            const items: MenuItemOptions[] = []

            if (isShared && sharedSession) {
                items.push({
                    label: this.translate.instant('Copy share link'),
                    click: async () => {
                        const success = await this.sessionSharing.copyShareableLink(tab)
                        if (success) {
                            this.notifications.notice(this.translate.instant('Share link copied to clipboard'))
                        } else {
                            this.notifications.error(this.translate.instant('Failed to copy share link'))
                        }
                    },
                })
                items.push({
                    label: this.translate.instant('View sharing details'),
                    click: async () => {
                        const shareUrl = await this.sessionSharing.shareSession(tab, { mode: sharedSession.mode })
                        if (shareUrl) {
                            const modal = this.ngbModal.open(ShareSessionModalComponent, {
                                backdrop: 'static',
                            })
                            modal.componentInstance.shareUrl = shareUrl
                            modal.componentInstance.mode = sharedSession.mode
                            modal.componentInstance.viewers = sharedSession.viewers
                            if (sharedSession.expiresAt) {
                                const expiresIn = Math.round((sharedSession.expiresAt.getTime() - Date.now()) / 60000)
                                if (expiresIn > 0) {
                                    modal.componentInstance.expiresIn = expiresIn
                                }
                            }
                        }
                    },
                })
                items.push({
                    label: this.translate.instant('Stop sharing'),
                    click: async () => {
                        await this.sessionSharing.stopSharing(tab)
                        this.notifications.notice(this.translate.instant('Session sharing stopped'))
                    },
                })
            } else {
                items.push({
                    label: this.translate.instant('Share session'),
                    click: async () => {
                        try {
                            // Show mode selector
                            if (this.selector.active) {
                                return
                            }

                            const modeOptions: SelectorOption<'read-only' | 'interactive'>[] = [
                                {
                                    name: this.translate.instant('Read-only'),
                                    description: this.translate.instant('Viewers can only see the terminal output'),
                                    icon: 'fas fa-eye',
                                    result: 'read-only' as 'read-only',
                                },
                                {
                                    name: this.translate.instant('Interactive'),
                                    description: this.translate.instant('Viewers can also send input to the terminal'),
                                    icon: 'fas fa-keyboard',
                                    result: 'interactive' as 'interactive',
                                },
                            ]

                            const selectedMode = await this.selector.show<'read-only' | 'interactive'>(
                                this.translate.instant('Select sharing mode'),
                                modeOptions,
                            ).catch(() => {
                                // User cancelled
                                return null
                            })

                            if (selectedMode) {
                                await this.shareWithMode(tab, selectedMode)
                            }
                        } catch (error) {
                            this.logger.error('Failed to share session:', error)
                            this.notifications.error(this.translate.instant('Failed to share session: {error}', { error: error.message || error }))
                        }
                    },
                })
            }

            return items
        }
        return []
    }

    private async shareWithMode (tab: BaseTerminalTabComponent<any>, mode: 'read-only' | 'interactive'): Promise<void> {
        try {
            const shareUrl = await this.sessionSharing.shareSession(tab, { mode })
            if (shareUrl) {
                // Copy URL to clipboard
                await this.sessionSharing.copyShareableLink(tab)
                
                const modal = this.ngbModal.open(ShareSessionModalComponent, {
                    backdrop: 'static',
                })
                modal.componentInstance.shareUrl = shareUrl
                modal.componentInstance.mode = mode
                modal.componentInstance.viewers = 0
                
                this.notifications.notice(this.translate.instant('Session shared! Share URL copied to clipboard.'))
            } else {
                this.notifications.error(this.translate.instant('Failed to share session. Please check console for details.'))
            }
        } catch (error) {
            this.logger.error('Failed to share session:', error)
            this.notifications.error(this.translate.instant('Failed to share session: {error}', { error: error.message || error }))
        }
    }
}

/** @hidden */
@Injectable()
export class SaveAsProfileContextMenu extends TabContextMenuItemProviderRuntime {
    constructor (
        private config: ConfigService,
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private hostApp: HostAppService,
        private platform: PlatformService,
    ) {
        super()
    }

    async getItems (tab: CoreBaseTabComponent): Promise<MenuItemOptions[]> {
        if (tab instanceof BaseTerminalTabComponent) {
            const storedProfile = this.config.store.profiles?.find(p => p.id === tab.profile.id)
            const canPickDirectory = this.hostApp.platform !== Platform.Web
            const items: MenuItemOptions[] = []
            if (storedProfile && canPickDirectory) {
                const hasDirectory = !!storedProfile.sessionLog?.directory?.trim()
                items.push({
                    label: this.translate.instant('Set log directory'),
                    type: 'checkbox',
                    checked: hasDirectory,
                    click: async () => {
                        try {
                            const nextSettings = {
                                enabled: storedProfile.sessionLog?.enabled ?? true,
                                directory: undefined as string|undefined,
                                filenameTemplate: storedProfile.sessionLog?.filenameTemplate,
                                append: storedProfile.sessionLog?.append,
                            }

                            if (hasDirectory) {
                                nextSettings.directory = undefined
                            } else {
                                const directory = await this.platform.pickDirectory()
                                if (!directory) {
                                    return
                                }
                                nextSettings.directory = directory
                            }

                            const hasSettings = nextSettings.enabled || nextSettings.append || nextSettings.directory || nextSettings.filenameTemplate
                            if (hasSettings) {
                                storedProfile.sessionLog = nextSettings
                                tab.profile.sessionLog = nextSettings
                            } else {
                                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                                delete storedProfile.sessionLog
                                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                                delete (tab.profile as any).sessionLog
                            }
                            await this.config.save()
                        } catch (error) {
                            this.notifications.error(this.translate.instant('Directory selection is not supported on this platform'))
                        }
                    },
                })
                items.push({
                    label: this.translate.instant('Use current working directory for logs'),
                    enabled: !!tab.session?.supportsWorkingDirectory(),
                    click: async () => {
                        const cwd = await tab.session?.getWorkingDirectory() ?? tab.profile.options.cwd
                        if (!cwd) {
                            this.notifications.error(this.translate.instant('Shell does not support current path detection'))
                            return
                        }

                        const nextSettings = {
                            enabled: storedProfile.sessionLog?.enabled ?? true,
                            directory: cwd,
                            filenameTemplate: storedProfile.sessionLog?.filenameTemplate,
                            append: storedProfile.sessionLog?.append,
                        }

                        storedProfile.sessionLog = nextSettings
                        tab.profile.sessionLog = nextSettings
                        await this.config.save()

                        if (this.hostApp.platform !== Platform.Web) {
                            this.platform.openPath(cwd)
                        }
                        this.notifications.info(this.translate.instant('Session log directory set to current working directory'))
                    },
                })
            }
            items.push({
                label: this.translate.instant('Save as profile'),
                click: async () => {
                    const modal = this.ngbModal.open(PromptModalComponent)
                    modal.componentInstance.prompt = this.translate.instant('New profile name')
                    modal.componentInstance.value = tab.profile.name
                    const name = (await modal.result.catch(() => null))?.value
                    if (!name) {
                        return
                    }

                    const options = JSON.parse(JSON.stringify(tab.profile.options))

                    const cwd = await tab.session?.getWorkingDirectory() ?? tab.profile.options.cwd
                    if (cwd) {
                        options.cwd = cwd
                    }

                    const profile: PartialProfile<Profile> = {
                        type: tab.profile.type,
                        name,
                        options,
                    }

                    profile.id = `${profile.type}:custom:${slugify(name)}:${uuidv4()}`
                    profile.group = tab.profile.group
                    profile.icon = tab.profile.icon
                    profile.color = tab.profile.color
                    profile.disableDynamicTitle = tab.profile.disableDynamicTitle
                    profile.behaviorOnSessionEnd = tab.profile.behaviorOnSessionEnd

                    this.config.store.profiles = [
                        ...this.config.store.profiles,
                        profile,
                    ]
                    this.config.save()
                    this.notifications.info(this.translate.instant('Saved'))
                },
            })
            return items
        }

        return []
    }
}
