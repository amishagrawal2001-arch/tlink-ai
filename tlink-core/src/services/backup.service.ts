import { Injectable, Injector } from '@angular/core'
import { v4 as uuidv4 } from 'uuid'
import * as crypto from 'crypto'
import { Observable, Subject } from 'rxjs'
import { ConfigService } from './config.service'
import { WorkspaceService } from './workspace.service'
import { ProfilesService } from './profiles.service'
import { PlatformService } from '../api/platform'
import { Logger, LogService } from './log.service'

export interface BackupConfig {
    enabled: boolean
    interval: number  // minutes
    retention: number  // days
    includeWorkspaces: boolean
    includeConfig: boolean
    includeProfiles: boolean
}

export interface Backup {
    id: string
    timestamp: Date
    size: number
    path: string
    checksum: string
    metadata: {
        version: string
        deviceId: string
        items: string[]
        appVersion?: string
    }
}

export interface BackupData {
    version: string
    timestamp: string
    deviceId: string
    config?: any
    workspaces?: any[]
    profiles?: any[]
    metadata: {
        appVersion?: string
        platform?: string
    }
}

@Injectable({ providedIn: 'root' })
export class BackupService {
    private logger: Logger
    private backupConfig: BackupConfig
    private backups: Backup[] = []
    private backupInterval: any
    private deviceId: string
    private backupDirectory: string
    private backupsChanged$ = new Subject<void>()

    get backupsChanged (): Observable<void> {
        return this.backupsChanged$.asObservable()
    }

    constructor (
        private config: ConfigService,
        private workspace: WorkspaceService,
        private profilesService: ProfilesService,
        private platform: PlatformService,
        _injector: Injector,
        log: LogService,
    ) {
        this.logger = log.create('backup')
        this.deviceId = this.getOrCreateDeviceId()
        this.backupDirectory = this.getBackupDirectory()
        
        // Defer all initialization until config is ready
        this.config.ready$.toPromise().then(async () => {
            try {
                this.loadBackupConfig()
                await this.ensureBackupDirectory()
                await this.loadBackupIndex()
                // Start automatic backups if enabled
                if (this.backupConfig?.enabled) {
                    this.startAutomaticBackups()
                }
            } catch (error) {
                this.logger.error('Failed to initialize backup service:', error)
            }
        }).catch(error => {
            this.logger.warn('Failed to wait for config ready:', error)
        })
    }

    /**
     * Get or create unique device ID
     */
    private getOrCreateDeviceId (): string {
        const stored = window.localStorage.getItem('tlink_device_id')
        if (stored) {
            return stored
        }
        const deviceId = uuidv4()
        window.localStorage.setItem('tlink_device_id', deviceId)
        return deviceId
    }

    /**
     * Get backup directory path
     */
    private getBackupDirectory (): string {
        // Get config directory from PlatformService if available
        // Fallback to IPC call if PlatformService doesn't expose getConfigPath
        try {
            const configPath = (this.platform as any).getConfigPath?.()
            if (configPath && typeof configPath === 'string') {
                const pathParts = configPath.split('/')
                pathParts.pop()  // Remove config.yaml
                return pathParts.join('/') + '/backups'
            }
        } catch {
            // PlatformService may not have getConfigPath
        }

        // Fallback: Use IPC to get config directory from main process
        // For now, return a relative path that will be resolved by IPC
        return 'backups'
    }

    /**
     * Ensure backup directory exists and get full path
     */
    private async ensureBackupDirectory (): Promise<void> {
        try {
            // Use IPC to get full backup directory path and create it in main process
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                const fullPath = await ipcRenderer.invoke('backup:get-directory-path')
                if (fullPath && typeof fullPath === 'string') {
                    this.backupDirectory = fullPath
                }
                await ipcRenderer.invoke('backup:ensure-directory', this.backupDirectory)
            } else {
                // Fallback: Try to create via platform service
                this.logger.warn('IPC not available, cannot ensure backup directory')
            }
        } catch (error) {
            this.logger.error('Failed to ensure backup directory:', error)
        }
    }

    /**
     * Get IPC renderer for Electron operations
     */
    private getIpcRenderer (): any {
        try {
            if (typeof window !== 'undefined' && (window as any).require) {
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

    /**
     * Load backup configuration from config store
     */
    private loadBackupConfig (): void {
        if (!this.config.store) {
            this.logger.warn('Config store not ready, using default backup config')
            this.backupConfig = {
                enabled: false,
                interval: 60,  // 60 minutes default
                retention: 30,  // 30 days default
                includeWorkspaces: true,
                includeConfig: true,
                includeProfiles: true,
            }
            return
        }
        // Clone the config values to get a plain object (not a proxy)
        const storeBackup = this.config.store.backup
        this.backupConfig = {
            enabled: storeBackup.enabled ?? false,
            interval: storeBackup.interval ?? 60,
            retention: storeBackup.retention ?? 30,
            includeWorkspaces: storeBackup.includeWorkspaces ?? true,
            includeConfig: storeBackup.includeConfig ?? true,
            includeProfiles: storeBackup.includeProfiles ?? true,
        }
    }

    /**
     * Save backup configuration to config store
     */
    private async saveBackupConfig (): Promise<void> {
        if (!this.config.store) {
            this.logger.warn('Config store not ready, cannot save backup config')
            return
        }
        try {
            // backup is a structural member (getter-only proxy), so we can't assign to it directly
            // We must set properties on the nested proxy instead
            // Set properties directly on the nested proxy, similar to config.store.configSync.configID = value
            // Accessing config.store.backup will return the nested proxy, which has setters for its properties
            this.config.store.backup.enabled = this.backupConfig.enabled ?? false
            this.config.store.backup.interval = this.backupConfig.interval ?? 60
            this.config.store.backup.retention = this.backupConfig.retention ?? 30
            this.config.store.backup.includeWorkspaces = this.backupConfig.includeWorkspaces ?? true
            this.config.store.backup.includeConfig = this.backupConfig.includeConfig ?? true
            this.config.store.backup.includeProfiles = this.backupConfig.includeProfiles ?? true
            await this.config.save()
        } catch (error: any) {
            this.logger.error('Failed to save backup config:', error)
            throw error
        }
    }

    /**
     * Load backup index (list of all backups)
     */
    private async loadBackupIndex (): Promise<void> {
        try {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                const index = await ipcRenderer.invoke('backup:load-index', this.backupDirectory)
                if (index && Array.isArray(index)) {
                    this.backups = index.map(b => ({
                        ...b,
                        timestamp: new Date(b.timestamp),
                    }))
                }
            }
        } catch (error) {
            this.logger.debug('Could not load backup index, starting fresh:', error)
            this.backups = []
        }
    }

    /**
     * Save backup index
     */
    private async saveBackupIndex (emitChange: boolean = true): Promise<void> {
        try {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                await ipcRenderer.invoke('backup:save-index', this.backupDirectory, this.backups)
            }
        } catch (error) {
            this.logger.error('Failed to save backup index:', error)
        }
        if (emitChange) {
            this.backupsChanged$.next()
        }
    }

    /**
     * Calculate checksum for data integrity
     */
    private async calculateChecksum (data: string): Promise<string> {
        return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
    }

    /**
     * Collect data for backup
     */
    private async collectBackupData (): Promise<BackupData> {
        const data: BackupData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            deviceId: this.deviceId,
            metadata: {
                appVersion: this.platform.getAppVersion(),
                platform: process.platform,
            },
        }

        if (this.backupConfig.includeConfig) {
            if (!this.config.store) {
                this.logger.warn('Config store not ready, skipping config in backup')
            } else {
                data.config = JSON.parse(JSON.stringify(this.config.store))
            }
        }

        if (this.backupConfig.includeWorkspaces) {
            data.workspaces = this.workspace.getWorkspaces().map(ws => ({
                ...ws,
                createdAt: ws.createdAt.toISOString(),
                updatedAt: ws.updatedAt.toISOString(),
            }))
        }

        if (this.backupConfig.includeProfiles) {
            if (!this.config.store) {
                this.logger.warn('Config store not ready, skipping profiles in backup')
            } else {
                data.profiles = JSON.parse(JSON.stringify(this.config.store.profiles || []))
            }
        }

        // Track what items are included
        const items: string[] = []
        if (data.config) items.push('config')
        if (data.workspaces && data.workspaces.length > 0) items.push(`workspaces(${data.workspaces.length})`)
        if (data.profiles && data.profiles.length > 0) items.push(`profiles(${data.profiles.length})`)

        return data
    }

    /**
     * Create a backup
     */
    async createBackup (manual: boolean = false, silent: boolean = false): Promise<Backup> {
        this.logger.info(`Creating ${manual ? 'manual' : 'automatic'} backup...`)

        const backup: Backup = {
            id: uuidv4(),
            timestamp: new Date(),
            size: 0,
            path: '',
            checksum: '',
            metadata: {
                version: '1.0',
                deviceId: this.deviceId,
                items: [],
                appVersion: this.platform.getAppVersion(),
            },
        }

        try {
            // Collect backup data
            const backupData = await this.collectBackupData()
            backup.metadata.items = [
                ...(backupData.config ? ['config'] : []),
                ...(backupData.workspaces && backupData.workspaces.length > 0 ? [`workspaces(${backupData.workspaces.length})`] : []),
                ...(backupData.profiles && backupData.profiles.length > 0 ? [`profiles(${backupData.profiles.length})`] : []),
            ]

            // Serialize to JSON
            const json = JSON.stringify(backupData, null, 2)
            backup.size = Buffer.byteLength(json, 'utf8')

            // Calculate checksum
            backup.checksum = await this.calculateChecksum(json)

            // Generate filename with timestamp
            const timestampStr = backup.timestamp.toISOString().replace(/[:.]/g, '-')
            const filename = `backup-${timestampStr}-${backup.id.substring(0, 8)}.json`
            backup.path = `${this.backupDirectory}/${filename}`

            // Save backup file via IPC
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                await ipcRenderer.invoke('backup:save-file', backup.path, json)
            } else {
                throw new Error('IPC not available, cannot save backup')
            }

            // Add to index
            this.backups.push(backup)
            await this.saveBackupIndex(!silent)

            // Cleanup old backups
            await this.cleanupOldBackups()

            this.logger.info(`Backup created successfully: ${backup.id} (${(backup.size / 1024).toFixed(2)} KB)`)
            return backup
        } catch (error) {
            this.logger.error('Failed to create backup:', error)
            throw error
        }
    }

    /**
     * Restore from a backup
     */
    async restoreBackup (backupId: string): Promise<void> {
        this.logger.info(`Restoring backup: ${backupId}`)

        const backup = this.backups.find(b => b.id === backupId)
        if (!backup) {
            throw new Error('Backup not found')
        }

        // Temporarily disable automatic backups during restore to prevent additional backups
        const wasAutomaticEnabled = this.backupConfig.enabled
        if (wasAutomaticEnabled) {
            this.stopAutomaticBackups()
            this.logger.info('Temporarily disabled automatic backups during restore')
        }

        try {
            // Load backup file
            const ipcRenderer = this.getIpcRenderer()
            if (!ipcRenderer) {
                throw new Error('IPC not available, cannot restore backup')
            }

            const json = await ipcRenderer.invoke('backup:load-file', backup.path)

            // Verify checksum
            const checksum = await this.calculateChecksum(json)
            if (checksum !== backup.checksum) {
                throw new Error('Backup integrity check failed - backup may be corrupted')
            }

            // Parse backup data
            const backupData: BackupData = JSON.parse(json)

            // Create a backup of current state before restore (safety)
            // Use silent=true to avoid triggering UI refresh during restore
            try {
                await this.createBackup(true, true)
                this.logger.info('Created safety backup before restore')
            } catch (error) {
                this.logger.warn('Failed to create safety backup before restore:', error)
                // Continue with restore anyway
            }

            if (!this.config.store) {
                throw new Error('Config store not ready, cannot restore backup')
            }

            // Restore configuration
            if (backupData.config && this.backupConfig.includeConfig) {
                // Note: We don't restore the entire config to avoid breaking ConfigProxy
                // Most config restoration should be done through specific services
                // Only restore non-structural, top-level settings that are safe to restore
                this.logger.warn('Full config restoration is not fully supported. Restore specific settings through their respective services.')
            }

            // Restore workspaces
            if (backupData.workspaces && this.backupConfig.includeWorkspaces && backupData.workspaces.length > 0) {
                // Clear existing workspaces and restore from backup
                const existingWorkspaces = this.workspace.getWorkspaces()
                for (const existing of existingWorkspaces) {
                    await this.workspace.deleteWorkspace(existing.id)
                }

                // Restore workspaces using WorkspaceService
                for (const ws of backupData.workspaces) {
                    // Create a new workspace with the saved data
                    // Note: We can't fully restore workspace state, so we just save the workspace definition
                    await this.workspace.saveWorkspace(ws.name, ws.description, ws.shared || false, ws.teamId)
                }
                await this.config.save()
            }

            // Restore profiles
            if (backupData.profiles && this.backupConfig.includeProfiles && backupData.profiles.length > 0) {
                // Get existing profile IDs to avoid duplicates
                const existingProfiles = this.config.store.profiles || []
                const existingIds = new Set(existingProfiles.map((p: any) => p.id))
                const newProfiles = backupData.profiles.filter((p: any) => !existingIds.has(p.id))
                
                // Add new profiles using ProfilesService
                if (newProfiles.length > 0) {
                    for (const profile of newProfiles) {
                        try {
                            await this.profilesService.newProfile(profile, { genId: false })
                        } catch (error) {
                            this.logger.warn(`Failed to restore profile ${profile.id}:`, error)
                        }
                    }
                    await this.config.save()
                }
            }

            // Emit change event after restore completes to refresh UI
            this.backupsChanged$.next()

            this.logger.info('Backup restored successfully')
        } catch (error) {
            this.logger.error('Failed to restore backup:', error)
            throw error
        } finally {
            // Re-enable automatic backups if they were enabled before restore
            // Skip initial backup since we just restored and don't need an immediate backup
            if (wasAutomaticEnabled && !this.backupInterval) {
                this.startAutomaticBackups(true)  // Skip initial backup after restore
                this.logger.info('Re-enabled automatic backups after restore (skipped initial backup)')
            }
        }
    }

    /**
     * Export backup to a file
     */
    async exportBackup (backupId: string, filePath: string): Promise<void> {
        const backup = this.backups.find(b => b.id === backupId)
        if (!backup) {
            throw new Error('Backup not found')
        }

        try {
            const ipcRenderer = this.getIpcRenderer()
            if (!ipcRenderer) {
                throw new Error('IPC not available, cannot export backup')
            }

            const json = await ipcRenderer.invoke('backup:load-file', backup.path)
            await ipcRenderer.invoke('backup:save-file', filePath, json)

            this.logger.info(`Backup exported to: ${filePath}`)
        } catch (error) {
            this.logger.error('Failed to export backup:', error)
            throw error
        }
    }

    /**
     * Import backup from a file
     */
    async importBackup (filePath: string): Promise<Backup> {
        try {
            const ipcRenderer = this.getIpcRenderer()
            if (!ipcRenderer) {
                throw new Error('IPC not available, cannot import backup')
            }

            const json = await ipcRenderer.invoke('backup:load-file', filePath)
            const backupData: BackupData = JSON.parse(json)

            // Create backup metadata
            const checksum = await this.calculateChecksum(json)
            const timestamp = backupData.timestamp ? new Date(backupData.timestamp) : new Date()

            const backup: Backup = {
                id: uuidv4(),
                timestamp,
                size: Buffer.byteLength(json, 'utf8'),
                path: filePath,  // Keep original path for import
                checksum,
                metadata: {
                    version: backupData.version || '1.0',
                    deviceId: backupData.deviceId || this.deviceId,
                    items: [
                        ...(backupData.config ? ['config'] : []),
                        ...(backupData.workspaces && backupData.workspaces.length > 0 ? [`workspaces(${backupData.workspaces.length})`] : []),
                        ...(backupData.profiles && backupData.profiles.length > 0 ? [`profiles(${backupData.profiles.length})`] : []),
                    ],
                    appVersion: backupData.metadata?.appVersion,
                },
            }

            // Copy to backup directory
            const timestampStr = backup.timestamp.toISOString().replace(/[:.]/g, '-')
            const filename = `imported-${timestampStr}-${backup.id.substring(0, 8)}.json`
            backup.path = `${this.backupDirectory}/${filename}`
            await ipcRenderer.invoke('backup:save-file', backup.path, json)

            // Add to index
            this.backups.push(backup)
            await this.saveBackupIndex()

            this.logger.info(`Backup imported successfully: ${backup.id}`)
            return backup
        } catch (error) {
            this.logger.error('Failed to import backup:', error)
            throw error
        }
    }

    /**
     * Delete a backup
     */
    async deleteBackup (backupId: string): Promise<void> {
        const backup = this.backups.find(b => b.id === backupId)
        if (!backup) {
            throw new Error('Backup not found')
        }

        try {
            const ipcRenderer = this.getIpcRenderer()
            if (ipcRenderer) {
                await ipcRenderer.invoke('backup:delete-file', backup.path)
            }

            this.backups = this.backups.filter(b => b.id !== backupId)
            await this.saveBackupIndex()

            this.logger.info(`Backup deleted: ${backupId}`)
        } catch (error) {
            this.logger.error('Failed to delete backup:', error)
            throw error
        }
    }

    /**
     * Get all backups (sorted by timestamp, newest first)
     */
    getBackups (): Backup[] {
        return [...this.backups].sort((a, b) => 
            b.timestamp.getTime() - a.timestamp.getTime()
        )
    }

    /**
     * Get a specific backup by ID
     */
    getBackup (backupId: string): Backup | null {
        return this.backups.find(b => b.id === backupId) || null
    }

    /**
     * Enable automatic backups
     */
    async enableAutomaticBackups (): Promise<void> {
        this.backupConfig.enabled = true
        await this.saveBackupConfig()
        this.startAutomaticBackups()
    }

    /**
     * Disable automatic backups
     */
    async disableAutomaticBackups (): Promise<void> {
        this.backupConfig.enabled = false
        await this.saveBackupConfig()
        this.stopAutomaticBackups()
    }

    /**
     * Start automatic backup schedule
     */
    startAutomaticBackups (skipInitial: boolean = false): void {
        this.stopAutomaticBackups()  // Clear any existing interval

        if (!this.backupConfig.enabled) {
            return
        }

        this.logger.info(`Starting automatic backups (interval: ${this.backupConfig.interval} minutes)`)

        // Create initial backup unless skipped (e.g., after restore)
        if (!skipInitial) {
            this.createBackup(false).catch(error => {
                this.logger.error('Initial automatic backup failed:', error)
            })
        }

        // Schedule periodic backups
        this.backupInterval = setInterval(() => {
            this.createBackup(false).catch(error => {
                this.logger.error('Automatic backup failed:', error)
            })
        }, this.backupConfig.interval * 60 * 1000)
    }

    /**
     * Stop automatic backup schedule
     */
    stopAutomaticBackups (): void {
        if (this.backupInterval) {
            clearInterval(this.backupInterval)
            this.backupInterval = null
            this.logger.info('Automatic backups stopped')
        }
    }

    /**
     * Clean up old backups based on retention policy
     */
    private async cleanupOldBackups (): Promise<void> {
        if (this.backupConfig.retention <= 0) {
            return  // No cleanup if retention is 0 or negative
        }

        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - this.backupConfig.retention)

        const oldBackups = this.backups.filter(b => b.timestamp < cutoffDate)
        
        if (oldBackups.length === 0) {
            return
        }

        this.logger.info(`Cleaning up ${oldBackups.length} old backup(s)...`)

        for (const backup of oldBackups) {
            try {
                await this.deleteBackup(backup.id)
            } catch (error) {
                this.logger.warn(`Failed to delete old backup ${backup.id}:`, error)
            }
        }
    }

    /**
     * Update backup configuration
     */
    async updateBackupConfig (config: Partial<BackupConfig>): Promise<void> {
        this.backupConfig = { ...this.backupConfig, ...config }
        await this.saveBackupConfig()

        // Restart automatic backups if enabled
        if (this.backupConfig.enabled) {
            this.startAutomaticBackups()
        } else {
            this.stopAutomaticBackups()
        }
    }

    /**
     * Get current backup configuration
     */
    getBackupConfig (): BackupConfig {
        return { ...this.backupConfig }
    }

    /**
     * Check if automatic backups are enabled
     */
    isEnabled (): boolean {
        return this.backupConfig.enabled
    }

    /**
     * Get backup statistics
     */
    getBackupStats (): {
        totalBackups: number
        totalSize: number
        oldestBackup: Date | null
        newestBackup: Date | null
    } {
        if (this.backups.length === 0) {
            return {
                totalBackups: 0,
                totalSize: 0,
                oldestBackup: null,
                newestBackup: null,
            }
        }

        const sorted = this.getBackups()
        const totalSize = this.backups.reduce((sum, b) => sum + b.size, 0)

        return {
            totalBackups: this.backups.length,
            totalSize,
            oldestBackup: sorted[sorted.length - 1].timestamp,
            newestBackup: sorted[0].timestamp,
        }
    }
}

