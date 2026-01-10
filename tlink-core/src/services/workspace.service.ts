import { Injectable } from '@angular/core'
import { v4 as uuidv4 } from 'uuid'
import { Workspace } from '../api/workspace'
import { RecoveryToken } from '../api/tabRecovery'
import { ConfigService } from './config.service'
import { TabRecoveryService } from './tabRecovery.service'
import { AppService } from './app.service'
import { Logger, LogService } from './log.service'
import { CodeEditorTabComponent } from '../components/codeEditorTab.component'
import { PlatformService } from '../api/platform'

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
    logger: Logger

    private constructor (
        private config: ConfigService,
        private tabRecovery: TabRecoveryService,
        private app: AppService,
        private platform: PlatformService,
        log: LogService,
    ) {
        this.logger = log.create('workspace')
        // Defer initialization until config is ready
        this.config.ready$.toPromise().then(() => {
            this.ensureWorkspacesConfig()
        }).catch(error => {
            this.logger.error('Failed to initialize workspace service:', error)
        })
    }

    /**
     * Ensure workspaces array exists in config
     */
    private ensureWorkspacesConfig (): void {
        if (!this.config.store || !this.config.store.workspaces) {
            if (!this.config.store) {
                this.logger.warn('Config store not ready, cannot ensure workspaces config')
                return
            }
            this.config.store.workspaces = []
        }
    }

    /**
     * Get all saved workspaces
     */
    getWorkspaces (): Workspace[] {
        this.ensureWorkspacesConfig()
        if (!this.config.store || !this.config.store.workspaces) {
            return []
        }
        return (this.config.store.workspaces as Workspace[]).map(w => ({
            ...w,
            createdAt: new Date(w.createdAt),
            updatedAt: new Date(w.updatedAt),
        }))
    }

    /**
     * Get a workspace by ID
     */
    getWorkspace (id: string): Workspace | null {
        const workspaces = this.getWorkspaces()
        return workspaces.find(w => w.id === id) ?? null
    }

    /**
     * Save current workspace state
     */
    async saveWorkspace (name: string, description?: string, shared: boolean = false, teamId?: string): Promise<Workspace> {
        this.ensureWorkspacesConfig()
        
        if (!this.config.store || !this.config.store.workspaces) {
            throw new Error('Config store not ready, cannot save workspace')
        }

        // Capture all tabs
        const tabs: RecoveryToken[] = []
        for (const tab of this.app.tabs) {
            const token = await this.tabRecovery.getFullRecoveryToken(tab, { includeState: true })
            if (token) {
                tabs.push(token)
            }
        }

        // Capture code editor folders
        const codeEditorFolders: string[] = []
        for (const tab of this.app.tabs) {
            if (tab instanceof CodeEditorTabComponent) {
                // Access folders through the component's internal state
                const codeEditor = tab as any
                if (codeEditor.folders && Array.isArray(codeEditor.folders)) {
                    for (const folder of codeEditor.folders) {
                        if (folder?.path && !codeEditorFolders.includes(folder.path)) {
                            codeEditorFolders.push(folder.path)
                        }
                    }
                }
            }
        }

        // Capture profiles used
        const profiles: string[] = []
        for (const tab of this.app.tabs) {
            if ((tab as any).profile?.id) {
                const profileId = (tab as any).profile.id
                if (!profiles.includes(profileId)) {
                    profiles.push(profileId)
                }
            }
        }

        // Capture layout structure
        const layout = this.captureLayout()

        const workspace: Workspace = {
            id: uuidv4(),
            name,
            description,
            tabs,
            codeEditorFolders,
            profiles,
            layout,
            shared,
            teamId,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            tags: [],
            isTemplate: false,
        }

        this.config.store.workspaces.push(workspace)
        await this.config.save()

        this.logger.info('Workspace saved:', workspace.id, workspace.name)
        return workspace
    }

    /**
     * Update an existing workspace
     */
    async updateWorkspace (id: string, updates: Partial<Workspace>): Promise<Workspace | null> {
        const workspaces = this.getWorkspaces()
        const index = workspaces.findIndex(w => w.id === id)
        if (index === -1) {
            return null
        }

        if (!this.config.store || !this.config.store.workspaces) {
            throw new Error('Config store not ready, cannot update workspace')
        }

        const workspace = workspaces[index]
        const updated: Workspace = {
            ...workspace,
            ...updates,
            id, // Ensure ID doesn't change
            version: workspace.version + 1,
            updatedAt: new Date(),
        }

        this.config.store.workspaces[index] = updated
        await this.config.save()

        this.logger.info('Workspace updated:', id)
        return updated
    }

    /**
     * Delete a workspace
     */
    async deleteWorkspace (id: string): Promise<boolean> {
        const workspaces = this.getWorkspaces()
        const index = workspaces.findIndex(w => w.id === id)
        if (index === -1) {
            return false
        }

        if (!this.config.store || !this.config.store.workspaces) {
            throw new Error('Config store not ready, cannot delete workspace')
        }

        this.config.store.workspaces.splice(index, 1)
        await this.config.save()

        this.logger.info('Workspace deleted:', id)
        return true
    }

    /**
     * Load a workspace (restore tabs and state)
     */
    async loadWorkspace (id: string): Promise<boolean> {
        const workspace = this.getWorkspace(id)
        if (!workspace) {
            this.logger.error('Workspace not found:', id)
            return false
        }

        // Close all current tabs
        const tabsToClose = [...this.app.tabs]
        for (const tab of tabsToClose) {
            tab.destroy()
        }

        // Restore tabs from workspace
        for (const token of workspace.tabs) {
            const tabParams = await this.tabRecovery.recoverTab(token)
            if (tabParams) {
                this.app.openNewTabRaw(tabParams)
            }
        }

        // Restore code editor folders after tabs are restored
        // Wait a bit for tabs to initialize
        setTimeout(() => {
            for (const tab of this.app.tabs) {
                if (tab instanceof CodeEditorTabComponent) {
                    const codeEditor = tab as any
                    // Add folders that aren't already present
                    for (const folderPath of workspace.codeEditorFolders) {
                        if (codeEditor.folders && !codeEditor.folders.some((f: any) => f.path === folderPath)) {
                            codeEditor.addFolder(folderPath)
                        }
                    }
                }
            }
        }, 500)

        this.logger.info('Workspace loaded:', id, workspace.name)
        return true
    }

    /**
     * Generate a shareable URL for a workspace
     */
    generateShareableUrl (workspaceId: string): string | null {
        const workspace = this.getWorkspace(workspaceId)
        if (!workspace) {
            return null
        }

        // Export workspace to JSON and encode as base64
        const workspaceData = {
            name: workspace.name,
            description: workspace.description,
            tabs: workspace.tabs,
            codeEditorFolders: workspace.codeEditorFolders,
            profiles: workspace.profiles,
            layout: workspace.layout,
            version: workspace.version,
        }

        try {
            const json = JSON.stringify(workspaceData)
            const base64 = btoa(unescape(encodeURIComponent(json)))
            // Use a custom protocol or data URL
            // For now, we'll use a data URL that can be shared
            return `tlink://workspace/${base64}`
        } catch (error) {
            this.logger.error('Failed to generate shareable URL:', error)
            return null
        }
    }

    /**
     * Import workspace from a shareable URL or base64 data
     */
    async importFromUrl (urlOrData: string): Promise<Workspace | null> {
        try {
            let workspaceData: any

            // Handle tlink://workspace/ protocol
            if (urlOrData.startsWith('tlink://workspace/')) {
                const base64 = urlOrData.replace('tlink://workspace/', '')
                const json = decodeURIComponent(escape(atob(base64)))
                workspaceData = JSON.parse(json)
            } else if (urlOrData.startsWith('data:')) {
                // Handle data URL
                const base64Match = urlOrData.match(/data:[^;]*;base64,(.+)/)
                if (base64Match) {
                    const json = decodeURIComponent(escape(atob(base64Match[1])))
                    workspaceData = JSON.parse(json)
                }
            } else {
                // Assume it's base64 encoded directly
                const json = decodeURIComponent(escape(atob(urlOrData)))
                workspaceData = JSON.parse(json)
            }

            // Create workspace from imported data
            const workspace: Workspace = {
                id: uuidv4(),
                name: workspaceData.name || 'Imported Workspace',
                description: workspaceData.description,
                tabs: workspaceData.tabs || [],
                codeEditorFolders: workspaceData.codeEditorFolders || [],
                profiles: workspaceData.profiles || [],
                layout: workspaceData.layout,
                shared: false,
                version: workspaceData.version || 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                tags: [],
                isTemplate: false,
            }

            if (!this.config.store || !this.config.store.workspaces) {
                this.ensureWorkspacesConfig()
                if (!this.config.store || !this.config.store.workspaces) {
                    throw new Error('Config store not ready, cannot import workspace')
                }
            }

            this.config.store.workspaces.push(workspace)
            await this.config.save()

            this.logger.info('Workspace imported from URL:', workspace.id, workspace.name)
            return workspace
        } catch (error) {
            this.logger.error('Failed to import workspace from URL:', error)
            return null
        }
    }

    /**
     * Export workspace to JSON string
     */
    exportWorkspace (workspaceId: string): string | null {
        const workspace = this.getWorkspace(workspaceId)
        if (!workspace) {
            return null
        }

        const exportData = {
            name: workspace.name,
            description: workspace.description,
            tabs: workspace.tabs,
            codeEditorFolders: workspace.codeEditorFolders,
            profiles: workspace.profiles,
            layout: workspace.layout,
            version: workspace.version,
            exportedAt: new Date().toISOString(),
        }

        return JSON.stringify(exportData, null, 2)
    }

    /**
     * Import workspace from JSON string
     */
    async importFromJson (json: string): Promise<Workspace | null> {
        try {
            const workspaceData = JSON.parse(json)

            const workspace: Workspace = {
                id: uuidv4(),
                name: workspaceData.name || 'Imported Workspace',
                description: workspaceData.description,
                tabs: workspaceData.tabs || [],
                codeEditorFolders: workspaceData.codeEditorFolders || [],
                profiles: workspaceData.profiles || [],
                layout: workspaceData.layout,
                shared: false,
                version: workspaceData.version || 1,
                createdAt: new Date(),
                updatedAt: new Date(),
                tags: [],
                isTemplate: false,
            }

            if (!this.config.store || !this.config.store.workspaces) {
                this.ensureWorkspacesConfig()
                if (!this.config.store || !this.config.store.workspaces) {
                    throw new Error('Config store not ready, cannot import workspace from JSON')
                }
            }

            this.config.store.workspaces.push(workspace)
            await this.config.save()

            this.logger.info('Workspace imported from JSON:', workspace.id, workspace.name)
            return workspace
        } catch (error) {
            this.logger.error('Failed to import workspace from JSON:', error)
            return null
        }
    }

    /**
     * Copy workspace shareable URL to clipboard
     */
    async copyShareableUrl (workspaceId: string): Promise<boolean> {
        const url = this.generateShareableUrl(workspaceId)
        if (!url) {
            return false
        }

        try {
            this.platform.setClipboard({ text: url })
            return true
        } catch (error) {
            this.logger.error('Failed to copy URL to clipboard:', error)
            return false
        }
    }

    /**
     * Capture the current layout structure
     */
    private captureLayout (): any {
        // For now, return a simple structure
        // This can be enhanced to capture split pane layouts
        return {
            tabs: this.app.tabs.length,
        }
    }

}

