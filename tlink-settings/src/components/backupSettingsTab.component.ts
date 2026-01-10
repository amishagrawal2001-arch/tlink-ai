import { Component, HostBinding, OnInit } from '@angular/core'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import {
    BaseComponent as CoreBaseComponent,
    BackupService,
    Backup,
    BackupConfig,
    NotificationsService,
    TranslateService,
    ConfigService,
} from 'tlink-core'

// Guard against missing core export
const BaseComponent: any = CoreBaseComponent ?? class {}

@Component({
    selector: 'backup-settings-tab',
    templateUrl: './backupSettingsTab.component.pug',
    styleUrls: ['./backupSettingsTab.component.scss'],
})
export class BackupSettingsTabComponent extends BaseComponent implements OnInit {
    backups: Backup[] = []
    backupConfig: BackupConfig = {
        enabled: false,
        interval: 60,
        retention: 30,
        includeWorkspaces: true,
        includeConfig: true,
        includeProfiles: true,
    }
    selectedBackup: Backup | null = null
    creatingBackup = false
    restoringBackup = false

    @HostBinding('class.content-box') true

    constructor (
        private backupService: BackupService,
        private config: ConfigService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        try {
            // Wait for config to be ready before loading
            await this.config.ready$.toPromise()
            this.loadBackupConfig()
            await this.loadBackups()

            // Subscribe to backup changes
            this.backupService.backupsChanged.subscribe(() => {
                this.loadBackups().catch(error => {
                    console.error('Failed to load backups on change:', error)
                })
            })
        } catch (error) {
            console.error('Failed to initialize backup settings tab:', error)
            this.notifications.error('Failed to initialize backup settings: ' + (error as any).message)
        }
    }

    loadBackupConfig (): void {
        try {
            this.backupConfig = this.backupService.getBackupConfig()
        } catch (error) {
            this.notifications.error('Failed to load backup configuration')
            console.error('Failed to load backup config:', error)
        }
    }

    async loadBackups (): Promise<void> {
        this.backups = this.backupService.getBackups()
    }

    async toggleAutomaticBackups (): Promise<void> {
        if (this.backupConfig.enabled) {
            await this.backupService.disableAutomaticBackups()
            this.notifications.notice(this.translate.instant('Automatic backups disabled'))
        } else {
            await this.backupService.enableAutomaticBackups()
            this.notifications.notice(this.translate.instant('Automatic backups enabled'))
        }
        this.loadBackupConfig()
    }

    async updateBackupInterval (): Promise<void> {
        if (this.backupConfig.interval < 1) {
            this.backupConfig.interval = 1
        }
        await this.backupService.updateBackupConfig({
            interval: this.backupConfig.interval,
        })
        this.notifications.notice(this.translate.instant('Backup interval updated'))
    }

    async updateBackupRetention (): Promise<void> {
        if (this.backupConfig.retention < 1) {
            this.backupConfig.retention = 1
        }
        await this.backupService.updateBackupConfig({
            retention: this.backupConfig.retention,
        })
        this.notifications.notice(this.translate.instant('Backup retention updated'))
    }

    async toggleIncludeWorkspaces (): Promise<void> {
        await this.backupService.updateBackupConfig({
            includeWorkspaces: this.backupConfig.includeWorkspaces,
        })
        this.notifications.notice(this.translate.instant('Backup configuration updated'))
    }

    async toggleIncludeConfig (): Promise<void> {
        await this.backupService.updateBackupConfig({
            includeConfig: this.backupConfig.includeConfig,
        })
        this.notifications.notice(this.translate.instant('Backup configuration updated'))
    }

    async toggleIncludeProfiles (): Promise<void> {
        await this.backupService.updateBackupConfig({
            includeProfiles: this.backupConfig.includeProfiles,
        })
        this.notifications.notice(this.translate.instant('Backup configuration updated'))
    }

    async createManualBackup (): Promise<void> {
        this.creatingBackup = true
        try {
            const backup = await this.backupService.createBackup(true)
            this.notifications.notice(
                this.translate.instant('Backup created: {name}', { name: backup.id.substring(0, 8) }),
            )
            this.selectedBackup = backup
            await this.loadBackups()
        } catch (error: any) {
            this.notifications.error(
                this.translate.instant('Failed to create backup: {error}', { error: error.message }),
            )
        } finally {
            this.creatingBackup = false
        }
    }

    async restoreBackup (backup: Backup): Promise<void> {
        if (!confirm(this.translate.instant('Restore backup from {date}? This will overwrite your current configuration.', {
            date: this.formatDate(backup.timestamp),
        }))) {
            return
        }

        this.restoringBackup = true
        try {
            await this.backupService.restoreBackup(backup.id)
            // Reload backups to show any changes (including safety backup)
            await this.loadBackups()
            this.notifications.notice(
                this.translate.instant('Backup restored successfully. Please restart the app for changes to take effect.'),
            )
        } catch (error: any) {
            this.notifications.error(
                this.translate.instant('Failed to restore backup: {error}', { error: error.message }),
            )
        } finally {
            this.restoringBackup = false
        }
    }

    async deleteBackup (backup: Backup): Promise<void> {
        if (!confirm(this.translate.instant('Delete backup from {date}?', {
            date: this.formatDate(backup.timestamp),
        }))) {
            return
        }

        try {
            await this.backupService.deleteBackup(backup.id)
            this.notifications.notice(this.translate.instant('Backup deleted'))
            await this.loadBackups()
            if (this.selectedBackup?.id === backup.id) {
                this.selectedBackup = null
            }
        } catch (error: any) {
            this.notifications.error(
                this.translate.instant('Failed to delete backup: {error}', { error: error.message }),
            )
        }
    }

    async exportBackup (backup: Backup): Promise<void> {
        try {
            // Show file picker via IPC
            const ipcRenderer = this.getIpcRenderer()
            if (!ipcRenderer) {
                this.notifications.error(this.translate.instant('IPC not available'))
                return
            }

            const result = await ipcRenderer.invoke('backup:show-save-dialog', {
                title: this.translate.instant('Export Backup'),
                defaultPath: `backup-${backup.timestamp.toISOString().replace(/[:.]/g, '-')}.json`,
                filters: [
                    { name: 'JSON Files', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            })

            if (result.canceled || !result.filePath) {
                return
            }

            await this.backupService.exportBackup(backup.id, result.filePath)
            this.notifications.notice(this.translate.instant('Backup exported successfully'))
        } catch (error: any) {
            this.notifications.error(
                this.translate.instant('Failed to export backup: {error}', { error: error.message }),
            )
        }
    }

    async importBackup (): Promise<void> {
        try {
            // Show file picker via IPC
            const ipcRenderer = this.getIpcRenderer()
            if (!ipcRenderer) {
                this.notifications.error(this.translate.instant('IPC not available'))
                return
            }

            const result = await ipcRenderer.invoke('backup:show-open-dialog', {
                title: this.translate.instant('Import Backup'),
                filters: [
                    { name: 'JSON Files', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
                properties: ['openFile'],
            })

            if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return
            }

            const backup = await this.backupService.importBackup(result.filePaths[0])
            this.notifications.notice(
                this.translate.instant('Backup imported: {name}', { name: backup.id.substring(0, 8) }),
            )
            this.selectedBackup = backup
            await this.loadBackups()
        } catch (error: any) {
            this.notifications.error(
                this.translate.instant('Failed to import backup: {error}', { error: error.message }),
            )
        }
    }

    formatDate (date: Date): string {
        return new Date(date).toLocaleString()
    }

    formatSize (bytes: number): string {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }

    getBackupStats (): {
        totalBackups: number
        totalSize: number
        oldestBackup: Date | null
        newestBackup: Date | null
    } {
        return this.backupService.getBackupStats()
    }

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
}

