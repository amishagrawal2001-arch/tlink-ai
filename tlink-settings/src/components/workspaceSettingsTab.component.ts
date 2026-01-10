import { Component, Injector } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import {
    BaseTabComponent as CoreBaseTabComponent,
    WorkspaceService,
    Workspace,
    NotificationsService,
    TranslateService,
    PromptModalComponent,
    PlatformService,
} from 'tlink-core'

// Guard against missing core export
const BaseTabComponent: any = CoreBaseTabComponent ?? class {}

@Component({
    selector: 'workspace-settings-tab',
    templateUrl: './workspaceSettingsTab.component.pug',
    styleUrls: ['./workspaceSettingsTab.component.scss'],
})
export class WorkspaceSettingsTabComponent extends BaseTabComponent {
    workspaces: Workspace[] = []
    selectedWorkspace: Workspace | null = null

    constructor (
        injector: Injector,
        private workspaceService: WorkspaceService,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private ngbModal: NgbModal,
        private platform: PlatformService,
    ) {
        super(injector)
        this.loadWorkspaces()
    }

    loadWorkspaces (): void {
        this.workspaces = this.workspaceService.getWorkspaces()
    }

    async saveCurrentWorkspace (): Promise<void> {
        const modal = this.ngbModal.open(PromptModalComponent, {
            backdrop: 'static',
        })
        modal.componentInstance.prompt = this.translate.instant('Workspace name')
        modal.componentInstance.value = ''
        modal.componentInstance.password = false

        try {
            const result = await modal.result
            if (result && result.value && result.value.trim()) {
                const workspace = await this.workspaceService.saveWorkspace(
                    result.value.trim(),
                    '',
                    false,
                )
                this.notifications.notice(this.translate.instant('Workspace saved'))
                this.loadWorkspaces()
                this.selectedWorkspace = workspace
            }
        } catch {
            // User cancelled
        }
    }

    async loadWorkspace (workspace: Workspace): Promise<void> {
        const success = await this.workspaceService.loadWorkspace(workspace.id)
        if (success) {
            this.notifications.notice(
                this.translate.instant('Workspace loaded: {name}', { name: workspace.name }),
            )
        } else {
            this.notifications.error(this.translate.instant('Failed to load workspace'))
        }
    }

    async deleteWorkspace (workspace: Workspace): Promise<void> {
        if (confirm(this.translate.instant('Delete workspace "{name}"?', { name: workspace.name }))) {
            const success = await this.workspaceService.deleteWorkspace(workspace.id)
            if (success) {
                this.notifications.notice(this.translate.instant('Workspace deleted'))
                this.loadWorkspaces()
                if (this.selectedWorkspace?.id === workspace.id) {
                    this.selectedWorkspace = null
                }
            } else {
                this.notifications.error(this.translate.instant('Failed to delete workspace'))
            }
        }
    }

    async shareWorkspace (workspace: Workspace): Promise<void> {
        const success = await this.workspaceService.copyShareableUrl(workspace.id)
        if (success) {
            this.notifications.notice(
                this.translate.instant('Workspace shareable URL copied to clipboard'),
            )
        } else {
            this.notifications.error(this.translate.instant('Failed to generate shareable URL'))
        }
    }

    async importWorkspaceFromUrl (): Promise<void> {
        const modal = this.ngbModal.open(PromptModalComponent, {
            backdrop: 'static',
        })
        modal.componentInstance.prompt = this.translate.instant('Workspace URL or base64 data')
        modal.componentInstance.value = ''
        modal.componentInstance.password = false

        try {
            const result = await modal.result
            if (result && result.value && result.value.trim()) {
                const workspace = await this.workspaceService.importFromUrl(result.value.trim())
                if (workspace) {
                    this.notifications.notice(
                        this.translate.instant('Workspace imported: {name}', { name: workspace.name }),
                    )
                    this.loadWorkspaces()
                    this.selectedWorkspace = workspace
                } else {
                    this.notifications.error(this.translate.instant('Failed to import workspace'))
                }
            }
        } catch {
            // User cancelled
        }
    }

    async exportWorkspace (workspace: Workspace): Promise<void> {
        const json = this.workspaceService.exportWorkspace(workspace.id)
        if (json) {
            // Copy JSON to clipboard
            this.platform.setClipboard({ text: json })
            this.notifications.notice(this.translate.instant('Workspace exported to clipboard'))
        } else {
            this.notifications.error(this.translate.instant('Failed to export workspace'))
        }
    }

    formatDate (date: Date): string {
        return new Date(date).toLocaleString()
    }
}

