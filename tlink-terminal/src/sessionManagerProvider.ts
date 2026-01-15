import { Injectable } from '@angular/core'
import { AppService, CommandProvider, HostAppService, SidePanelRegistration, SidePanelService, SplitTabComponent } from 'tlink-core'
import type { Command } from 'tlink-core'

import { SessionManagerTabComponent } from './components/sessionManagerTab.component'
import { ColorTemplatesPanelComponent } from './components/colorTemplatesPanel.component'

const SESSION_MANAGER_WIDTH = 320
const SESSION_MANAGER_PANEL: SidePanelRegistration = {
    id: 'session-manager',
    component: SessionManagerTabComponent,
    label: 'Session Manager',
    width: SESSION_MANAGER_WIDTH,
    mode: 'all',
}
const ACTIVE_CONNECTIONS_PANEL: SidePanelRegistration = {
    id: 'active-connections',
    component: SessionManagerTabComponent,
    label: 'Active Connections',
    width: SESSION_MANAGER_WIDTH,
    mode: 'connections',
}
const BUILTIN_CONNECTIONS_PANEL: SidePanelRegistration = {
    id: 'built-in-connections',
    component: SessionManagerTabComponent,
    label: 'Built-in Connections',
    width: SESSION_MANAGER_WIDTH,
    mode: 'built-in',
}
const REMOTE_DESKTOP_PANEL: SidePanelRegistration = {
    id: 'remote-desktop',
    component: SessionManagerTabComponent,
    label: 'Remote Desktop',
    width: SESSION_MANAGER_WIDTH,
    mode: null,
}
const COLOR_TEMPLATES_PANEL: SidePanelRegistration = {
    id: 'color-templates',
    component: ColorTemplatesPanelComponent,
    label: 'Color Templates',
    width: 420,
}

@Injectable()
export class SessionManagerCommandProvider extends CommandProvider {
    private cleanupInProgress = false

    constructor (
        private app: AppService,
        private sidePanel: SidePanelService,
        hostApp: HostAppService,
    ) {
        super()
        this.sidePanel.register(SESSION_MANAGER_PANEL)
        this.sidePanel.register(ACTIVE_CONNECTIONS_PANEL)
        this.sidePanel.register(BUILTIN_CONNECTIONS_PANEL)
        this.sidePanel.register(REMOTE_DESKTOP_PANEL)
        this.sidePanel.register(COLOR_TEMPLATES_PANEL)
        this.app.tabsChanged$.subscribe(() => this.cleanupLegacyTabs())
        hostApp.sessionManagerRequest$.subscribe(() => {
            this.cleanupLegacyTabs()
            this.sidePanel.show(SESSION_MANAGER_PANEL)
        })
    }

    async provide (): Promise<Command[]> {
        return []
    }

    private cleanupLegacyTabs (): void {
        if (this.cleanupInProgress) {
            return
        }

        const legacyTabs = this.findLegacySessionManagerTabs()
        if (!legacyTabs.length) {
            return
        }

        this.cleanupInProgress = true
        try {
            for (const tab of legacyTabs) {
                const parent = tab.parent
                if (parent instanceof SplitTabComponent) {
                    parent.removeTab(tab)
                    tab.destroy()
                    this.unwrapSplitIfSingle(parent)
                    continue
                }
                if (this.app.tabs.includes(tab)) {
                    void this.app.closeTab(tab, true)
                } else {
                    tab.destroy()
                }
            }
        } finally {
            this.cleanupInProgress = false
        }
    }

    private unwrapSplitIfSingle (split: SplitTabComponent): void {
        if (split.parent instanceof SplitTabComponent) {
            return
        }
        const remaining = split.getAllTabs()
        if (remaining.length !== 1) {
            return
        }
        const remainingTab = remaining[0]
        const index = this.app.tabs.indexOf(split)
        if (index === -1) {
            return
        }
        split.removeTab(remainingTab)
        this.app.addTabRaw(remainingTab, index)
    }

    private findLegacySessionManagerTabs (): SessionManagerTabComponent[] {
        const found: SessionManagerTabComponent[] = []
        for (const tab of this.app.tabs) {
            if (tab instanceof SessionManagerTabComponent) {
                found.push(tab)
                continue
            }
            if (tab instanceof SplitTabComponent) {
                for (const nested of tab.getAllTabs()) {
                    if (nested instanceof SessionManagerTabComponent) {
                        found.push(nested)
                    }
                }
            }
        }
        return found
    }
}
