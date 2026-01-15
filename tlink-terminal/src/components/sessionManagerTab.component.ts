import { Component, HostBinding, Inject, Injector } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import deepClone from 'clone-deep'
import { AppService, BaseTabComponent as CoreBaseTabComponent, MenuItemOptions, NotificationsService, PartialProfile, PartialProfileGroup, PlatformService, Profile, ProfileGroup, ProfileProvider, ProfilesService, PromptModalComponent, SidePanelService, SplitTabComponent, TranslateService } from 'tlink-core'
import { EditProfileGroupModalComponent, EditProfileGroupModalComponentResult, EditProfileModalComponent } from 'tlink-settings'
import { BaseTerminalTabComponent } from '../api/baseTerminalTab.component'
import { ProfileCreateModalComponent } from './profileCreateModal.component'

// Fallback base class to avoid runtime crashes if the core export is undefined
const BaseTabComponentRuntime: typeof CoreBaseTabComponent = (CoreBaseTabComponent ?? class extends (Object as any) {}) as typeof CoreBaseTabComponent
type BaseTabComponent = CoreBaseTabComponent

interface SessionConnection {
    id: string
    title: string
    detail: string
    protocol: string
    isOpen: boolean
    tab: BaseTerminalTabComponent<any>
}

type SessionProfileGroup = PartialProfileGroup<ProfileGroup> & {
    collapsed?: boolean
    profiles?: PartialProfile<Profile>[]
}

function generateId (): string {
    return Math.random().toString(36).slice(2, 10)
}

@Component({
    selector: 'session-manager-tab',
    templateUrl: './sessionManagerTab.component.pug',
    styleUrls: ['./sessionManagerTab.component.scss'],
})
export class SessionManagerTabComponent extends BaseTabComponentRuntime {
    @HostBinding('class.session-manager-tab') hostClass = true
    @HostBinding('class.session-manager-split') get isSplitHost (): boolean { return this.parent instanceof SplitTabComponent }

    filterText = ''
    profileGroups: SessionProfileGroup[] = []
    connections: SessionConnection[] = []
    filteredConnections: SessionConnection[] = []
    filteredGroups: SessionProfileGroup[] = []
    visibleGroups: SessionProfileGroup[] = []
    selectedProfileIds = new Set<string>()
    selectedGroupIds = new Set<string>()
    viewMode: 'all' | 'connections' | 'built-in' = 'all'
    activePanelId = 'session-manager'
    private lastPanelId = 'session-manager'

    private collapsedByGroupId: Record<string, boolean> = {}
    private connectionIdByTab = new WeakMap<BaseTerminalTabComponent<any>, string>()

    constructor (
        private app: AppService,
        private profiles: ProfilesService,
        private sidePanel: SidePanelService,
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private platform: PlatformService,
        private translate: TranslateService,
        @Inject(ProfileProvider) private profileProviders: ProfileProvider<Profile>[],
        injector: Injector,
    ) {
        super(injector)
        this.setTitle('Session Manager')
    }

    ngOnInit (): void {
        this.refreshConnections()
        void this.refreshProfiles()
        this.subscribeUntilDestroyed(this.app.tabsChanged$, () => this.refreshConnections())
        this.subscribeUntilDestroyed(this.app.activeTabChange$, () => this.refreshConnections())
        this.subscribeUntilDestroyed(this.config.changed$, () => {
            void this.refreshProfiles()
        })
        this.subscribeUntilDestroyed(this.sidePanel.state$, state => {
            if (state.component !== SessionManagerTabComponent) {
                return
            }
            this.activePanelId = state.id || 'session-manager'
            if (state.id === 'active-connections') {
                this.viewMode = 'connections'
                if (this.lastPanelId !== this.activePanelId) {
                    this.lastPanelId = this.activePanelId
                    void this.refreshProfiles()
                }
                return
            }
            if (state.id === 'built-in-connections') {
                this.viewMode = 'built-in'
                if (this.lastPanelId !== this.activePanelId) {
                    this.lastPanelId = this.activePanelId
                    void this.refreshProfiles()
                }
                return
            }
            if (state.id === 'remote-desktop') {
                this.viewMode = 'built-in'
                if (this.lastPanelId !== this.activePanelId) {
                    this.lastPanelId = this.activePanelId
                    void this.refreshProfiles()
                }
                return
            }
            if (state.id === 'session-manager') {
                this.viewMode = 'all'
                if (this.lastPanelId !== this.activePanelId) {
                    this.lastPanelId = this.activePanelId
                    void this.refreshProfiles()
                }
                return
            }

            const mode = state.mode ?? 'all'
            if (mode === 'connections' || mode === 'built-in' || mode === 'all') {
                this.viewMode = mode
            } else {
                this.viewMode = 'all'
            }
            if (this.lastPanelId !== this.activePanelId) {
                this.lastPanelId = this.activePanelId
                void this.refreshProfiles()
            }
        })
    }

    get hasConnections (): boolean {
        return this.filteredConnections.length > 0
    }

    get hasProfiles (): boolean {
        return this.visibleGroups.some(group => (group.profiles?.length ?? 0) > 0)
    }

    get showConnections (): boolean {
        if (this.activePanelId === 'active-connections') {
            return true
        }
        if (this.isBuiltInPanel() || this.isRemoteDesktopPanel()) {
            return false
        }
        return this.viewMode === 'connections'
    }

    get showProfiles (): boolean {
        if (this.activePanelId === 'active-connections') {
            return false
        }
        if (this.isBuiltInPanel() || this.isRemoteDesktopPanel()) {
            return true
        }
        return this.viewMode !== 'connections'
    }

    get selectionCount (): number {
        return this.selectedProfiles.length + this.selectedGroups.length
    }

    get canEditSelection (): boolean {
        const profiles = this.selectedProfiles
        const groups = this.selectedGroups
        if (profiles.length === 1 && groups.length === 0) {
            return true
        }
        if (groups.length === 1 && profiles.length === 0) {
            return true
        }
        return false
    }

    clearFilter (): void {
        this.filterText = ''
        this.applyFilter()
    }

    onFilterTextChange (value: string): void {
        this.filterText = value
        this.applyFilter()
    }

    clearSelection (): void {
        this.selectedProfileIds.clear()
        this.selectedGroupIds.clear()
    }

    toggleGroup (group: SessionProfileGroup): void {
        group.collapsed = !group.collapsed
        this.collapsedByGroupId[group.id ?? ''] = group.collapsed ?? false
    }

    openGroupContextMenu (event: MouseEvent, group: SessionProfileGroup): void {
        event.preventDefault()
        event.stopPropagation()
        const canCreate = !!group && (group.editable || group.id === 'ungrouped')
        const canEdit = !!group?.editable
        const menu: MenuItemOptions[] = [
            {
                label: this.translate.instant('New profile'),
                enabled: canCreate,
                click: () => this.createProfile(group),
            },
            { type: 'separator' },
            {
                label: this.translate.instant('Edit group'),
                enabled: canEdit,
                click: () => this.editGroup(group),
            },
            {
                label: this.translate.instant('Delete group'),
                enabled: canEdit,
                click: () => this.deleteGroup(group),
            },
        ]
        this.platform.popupContextMenu(menu, event)
    }

    openProfileContextMenu (event: MouseEvent, profile: PartialProfile<Profile>): void {
        event.preventDefault()
        event.stopPropagation()
        const canEdit = !!profile && !profile.isBuiltin
        const menu: MenuItemOptions[] = [
            {
                label: this.translate.instant('Edit profile'),
                enabled: canEdit,
                click: () => this.editProfile(profile),
            },
            {
                label: this.translate.instant('Delete profile'),
                enabled: canEdit,
                click: () => this.deleteProfile(profile),
            },
        ]
        this.platform.popupContextMenu(menu, event)
    }

    selectGroup (group: SessionProfileGroup, event: MouseEvent): void {
        if (!group.editable || !group.id) {
            return
        }
        const multi = this.isMultiSelect(event)
        if (!multi) {
            this.clearSelection()
        }
        if (this.selectedGroupIds.has(group.id) && multi) {
            this.selectedGroupIds.delete(group.id)
        } else {
            this.selectedGroupIds.add(group.id)
        }
    }

    selectProfile (profile: PartialProfile<Profile>, event: MouseEvent): void {
        if (profile.isBuiltin || !profile.id) {
            return
        }
        const multi = this.isMultiSelect(event)
        if (!multi) {
            this.clearSelection()
        }
        if (this.selectedProfileIds.has(profile.id) && multi) {
            this.selectedProfileIds.delete(profile.id)
        } else {
            this.selectedProfileIds.add(profile.id)
        }
    }

    isGroupSelected (group: SessionProfileGroup): boolean {
        return !!group.id && this.selectedGroupIds.has(group.id)
    }

    isProfileSelected (profile: PartialProfile<Profile>): boolean {
        return !!profile.id && this.selectedProfileIds.has(profile.id)
    }

    focusConnection (connection: SessionConnection): void {
        const tab = this.findConnectionTab(connection)
        if (!tab) {
            return
        }
        this.focusTab(tab)
    }

    async openProfile (profile: PartialProfile<Profile>): Promise<void> {
        const existing = this.findTabForProfile(profile)
        if (existing) {
            this.focusTab(existing)
            return
        }
        await this.profiles.openNewTabForProfile(profile)
    }

    async editSelected (): Promise<void> {
        const profiles = this.selectedProfiles
        const groups = this.selectedGroups
        if (profiles.length === 1 && groups.length === 0) {
            await this.editProfile(profiles[0])
            return
        }
        if (groups.length === 1 && profiles.length === 0) {
            await this.editGroup(groups[0])
        }
    }

    async deleteSelected (): Promise<void> {
        const profiles = this.selectedProfiles
        const groups = this.selectedGroups
        if (!profiles.length && !groups.length) {
            return
        }

        const confirmMessage = this.translate.instant('Delete selected items?')
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: confirmMessage,
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response !== 0) {
            return
        }

        let deleteProfilesForGroups = false
        const groupsWithProfiles = groups.filter(group => (group.profiles?.length ?? 0) > 0)
        if (groupsWithProfiles.length > 0) {
            const response = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Delete the group\'s profiles?'),
                buttons: [
                    this.translate.instant('Move to "Ungrouped"'),
                    this.translate.instant('Delete'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 0,
                cancelId: 2,
            })
            if (response.response === 2) {
                return
            }
            deleteProfilesForGroups = response.response === 1
        }

        const groupIds = new Set(groups.map(group => group.id))
        for (const profile of profiles) {
            if (deleteProfilesForGroups && profile.group && groupIds.has(profile.group)) {
                continue
            }
            await this.profiles.deleteProfile(profile)
        }

        for (const group of groups) {
            await this.profiles.deleteProfileGroup(group, { deleteProfiles: deleteProfilesForGroups })
        }

        await this.config.save()
        await this.refreshProfiles()
        this.clearSelection()
    }

    async editProfile (profile: PartialProfile<Profile>): Promise<void> {
        if (profile.isBuiltin) {
            return
        }
        const result = await this.showProfileEditModal(profile)
        if (!result) {
            return
        }
        await this.profiles.writeProfile(result)
        await this.config.save()
        await this.refreshProfiles()
    }

    async deleteProfile (profile: PartialProfile<Profile>): Promise<void> {
        if (profile.isBuiltin) {
            return
        }
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', profile),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            await this.profiles.deleteProfile(profile)
            await this.config.save()
            await this.refreshProfiles()
        }
    }

    async editGroup (group: SessionProfileGroup): Promise<void> {
        if (!group.editable) {
            return
        }
        const result = await this.showProfileGroupEditModal(group)
        if (!result) {
            return
        }
        await this.profiles.writeProfileGroup(this.cleanProfileGroup(result))
        await this.config.save()
        await this.refreshProfiles()
    }

    async deleteGroup (group: SessionProfileGroup): Promise<void> {
        if (!group.editable) {
            return
        }
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', group),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response !== 0) {
            return
        }

        let deleteProfiles = false
        if ((group.profiles?.length ?? 0) > 0 && (await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete the group\'s profiles?'),
                buttons: [
                    this.translate.instant('Move to "Ungrouped"'),
                    this.translate.instant('Delete'),
                ],
                defaultId: 0,
                cancelId: 0,
            },
        )).response !== 0) {
            deleteProfiles = true
        }

        await this.profiles.deleteProfileGroup(group, { deleteProfiles })
        await this.config.save()
        await this.refreshProfiles()
    }

    async createProfile (group?: SessionProfileGroup): Promise<void> {
        const modal = this.ngbModal.open(ProfileCreateModalComponent)
        if (group?.editable) {
            modal.componentInstance.groupId = group.id ?? ''
        }

        const result = await modal.result.catch(() => null)
        if (result) {
            await this.refreshProfiles()
        }
    }

    async createGroup (): Promise<void> {
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = 'New profile group name'
        const result = await modal.result.catch(() => null)
        const name = result?.value?.trim()
        if (!name) {
            return
        }

        const existing = (await this.profiles.getProfileGroups({ includeProfiles: false, includeNonUserGroup: false }))
            .find(group => group.name?.toLowerCase() === name.toLowerCase())
        if (existing) {
            this.notifications.error('Group already exists')
            return
        }

        try {
            await this.profiles.newProfileGroup({ id: '', name })
            await this.config.save()
            await this.refreshProfiles()
        } catch (error) {
            console.error('Failed to create profile group', error)
            this.notifications.error('Failed to create group')
        }
    }

    closePanel (): void {
        if (this.sidePanel.isShowing(SessionManagerTabComponent)) {
            this.sidePanel.hide()
            return
        }
        if (this.parent instanceof SplitTabComponent) {
            this.destroy()
            return
        }
        this.app.closeTab(this, true)
    }

    private async refreshProfiles (): Promise<void> {
        const panelState = this.sidePanel.getState()
        if (panelState.component === SessionManagerTabComponent && panelState.id) {
            this.activePanelId = panelState.id
        }
        const includeBuiltIn = this.isBuiltInPanel() || this.isRemoteDesktopPanel()
        const groups = await this.profiles.getProfileGroups({ includeProfiles: true, includeNonUserGroup: includeBuiltIn })
        const normalized = groups.map(group => ({
            ...group,
            name: group.id === 'built-in' ? 'Built-in Connections' : group.name,
            profiles: group.profiles ?? [],
            collapsed: this.collapsedByGroupId[group.id ?? ''] ?? false,
        }))
        if (this.isBuiltInPanel()) {
            this.profileGroups = normalized.filter(group => this.isBuiltInGroup(group))
        } else if (this.isRemoteDesktopPanel()) {
            this.profileGroups = normalized
        } else {
            this.profileGroups = normalized.filter(group => !this.isBuiltInGroup(group))
        }
        if (this.isRemoteDesktopPanel()) {
            this.profileGroups = this.profileGroups
                .map(group => ({
                    ...group,
                    profiles: (group.profiles ?? []).filter(profile => profile.type === 'rdp' && !profile.isBuiltin),
                }))
                .filter(group => (group.profiles?.length ?? 0) > 0)
        }
        this.pruneSelections()
        this.applyFilter()
    }

    private refreshConnections (): void {
        const terminals = this.getAllTerminalTabs()
        this.connections = terminals.map(tab => this.buildConnection(tab))
            .sort((a, b) => a.title.localeCompare(b.title))
        this.applyFilter()
    }

    private buildConnection (tab: BaseTerminalTabComponent<any>): SessionConnection {
        const profile = (tab.profile ?? null) as PartialProfile<Profile> | null
        const title = tab.title || profile?.name || 'Terminal'
        const host = profile?.options?.host ?? ''
        const user = profile?.options?.user ?? ''
        const detail = user && host ? `${user}@${host}` : (host || user || '')
        const protocol = profile?.type ?? 'terminal'
        return {
            id: this.getConnectionId(tab),
            title,
            detail,
            protocol,
            isOpen: !!tab.session?.open,
            tab,
        }
    }

    private isBuiltInGroup (group: SessionProfileGroup): boolean {
        if (group.id === 'ungrouped') {
            return false
        }
        if (group.editable !== true) {
            return true
        }
        if (group.id === 'built-in') {
            return true
        }
        return (group.profiles ?? []).some(profile => profile.isBuiltin)
    }

    private isBuiltInPanel (): boolean {
        return this.activePanelId === 'built-in-connections'
    }

    private isRemoteDesktopPanel (): boolean {
        return this.activePanelId === 'remote-desktop'
    }

    trackByConnection (_index: number, connection: SessionConnection): string {
        return connection.id
    }

    trackByGroup (index: number, group: SessionProfileGroup): string | number {
        return group.id ?? group.name ?? index
    }

    trackByProfile (index: number, profile: PartialProfile<Profile>): string | number {
        return profile.id ?? profile.name ?? index
    }

    private getAllTerminalTabs (): BaseTerminalTabComponent<any>[] {
        const expanded: BaseTabComponent[] = []
        for (const tab of this.app.tabs) {
            if (tab instanceof SplitTabComponent) {
                expanded.push(...tab.getAllTabs())
            } else {
                expanded.push(tab)
            }
        }
        return expanded.filter(tab => tab instanceof BaseTerminalTabComponent) as BaseTerminalTabComponent<any>[]
    }

    private findTabForProfile (profile: PartialProfile<Profile>): BaseTerminalTabComponent<any> | null {
        if (!profile?.id) {
            return null
        }
        for (const tab of this.getAllTerminalTabs()) {
            if ((tab.profile as PartialProfile<Profile> | undefined)?.id === profile.id) {
                return tab
            }
        }
        return null
    }

    private focusTab (tab: BaseTabComponent): void {
        const parent = this.app.getParentTab(tab)
        if (parent) {
            parent.focus(tab)
            this.app.selectTab(parent)
            return
        }
        this.app.selectTab(tab)
    }

    private getConnectionId (tab: BaseTerminalTabComponent<any>): string {
        let id = this.connectionIdByTab.get(tab)
        if (!id) {
            id = generateId()
            this.connectionIdByTab.set(tab, id)
        }
        return id
    }

    private findConnectionTab (connection: SessionConnection): BaseTerminalTabComponent<any> | null {
        const tabs = this.getAllTerminalTabs()
        if (tabs.includes(connection.tab)) {
            return connection.tab
        }
        const match = tabs.find(tab => this.getConnectionId(tab) === connection.id)
        return match ?? null
    }

    private get normalizedFilter (): string {
        return this.filterText.trim().toLowerCase()
    }

    private matchesFilter (filter: string, candidates: string[]): boolean {
        return candidates.some(candidate => candidate.toLowerCase().includes(filter))
    }

    private profileMatchesFilter (profile: PartialProfile<Profile>, filter: string, groupMatches: boolean): boolean {
        if (groupMatches) {
            return true
        }
        const candidates = [
            profile.name ?? '',
            profile.group ?? '',
            profile.type ?? '',
            profile.options?.host ?? '',
            profile.options?.user ?? '',
        ]
        return this.matchesFilter(filter, candidates)
    }

    private applyFilter (): void {
        const filter = this.normalizedFilter
        if (!filter) {
            this.filteredConnections = this.connections
            this.filteredGroups = this.profileGroups
        } else {
            this.filteredConnections = this.connections.filter(connection => this.matchesFilter(filter, [
                connection.title,
                connection.detail,
                connection.protocol,
            ]))

            const filtered: SessionProfileGroup[] = []
            for (const group of this.profileGroups) {
                const groupMatches = this.matchesFilter(filter, [group.name ?? ''])
                const profiles = (group.profiles ?? []).filter(profile => this.profileMatchesFilter(profile, filter, groupMatches))
                if (profiles.length || groupMatches) {
                    filtered.push({
                        ...group,
                        profiles,
                        collapsed: this.collapsedByGroupId[group.id ?? ''] ?? group.collapsed ?? false,
                    })
                }
            }
            this.filteredGroups = filtered
        }

        if (this.isBuiltInPanel()) {
            this.visibleGroups = this.filteredGroups.filter(group => this.isBuiltInGroup(group))
        } else if (this.isRemoteDesktopPanel()) {
            this.visibleGroups = this.filteredGroups
        } else {
            this.visibleGroups = this.filteredGroups.filter(group => !this.isBuiltInGroup(group))
        }
        if (this.isRemoteDesktopPanel()) {
            this.visibleGroups = this.visibleGroups.filter(group => (group.profiles?.length ?? 0) > 0)
        }
    }

    private pruneSelections (): void {
        const groupIds = new Set(this.profileGroups.map(group => group.id))
        for (const id of Array.from(this.selectedGroupIds)) {
            if (!groupIds.has(id)) {
                this.selectedGroupIds.delete(id)
            }
        }

        const profileIds = new Set<string>()
        for (const group of this.profileGroups) {
            for (const profile of group.profiles ?? []) {
                if (profile.id) {
                    profileIds.add(profile.id)
                }
            }
        }
        for (const id of Array.from(this.selectedProfileIds)) {
            if (!profileIds.has(id)) {
                this.selectedProfileIds.delete(id)
            }
        }
    }

    private get selectedProfiles (): PartialProfile<Profile>[] {
        const results: PartialProfile<Profile>[] = []
        for (const group of this.profileGroups) {
            for (const profile of group.profiles ?? []) {
                if (profile.id && this.selectedProfileIds.has(profile.id)) {
                    results.push(profile)
                }
            }
        }
        return results
    }

    private get selectedGroups (): SessionProfileGroup[] {
        return this.profileGroups.filter(group => group.id && this.selectedGroupIds.has(group.id))
    }

    private isMultiSelect (event: MouseEvent): boolean {
        return event.metaKey || event.ctrlKey
    }

    private async showProfileEditModal (profile: PartialProfile<Profile>): Promise<PartialProfile<Profile> | null> {
        const provider = this.profiles.providerForProfile(profile)
        if (!provider) {
            this.notifications.error('Cannot edit a profile without a provider')
            return null
        }
        const modal = this.ngbModal.open(EditProfileModalComponent, { size: 'lg' })
        modal.componentInstance.profile = deepClone(profile)
        modal.componentInstance.profileProvider = provider

        const result = await modal.result.catch(() => null)
        if (!result) {
            return null
        }

        result.type = provider.id
        return result
    }

    private async showProfileGroupEditModal (group: SessionProfileGroup): Promise<SessionProfileGroup | null> {
        this.profileProviders.sort((a, b) => a.name.localeCompare(b.name))
        const modal = this.ngbModal.open(EditProfileGroupModalComponent, { size: 'lg' })
        modal.componentInstance.group = deepClone(group)
        modal.componentInstance.providers = this.profileProviders

        const result: EditProfileGroupModalComponentResult<ProfileGroup> | null = await modal.result.catch(() => null)
        if (!result) {
            return null
        }

        if (result.provider) {
            return this.editProfileGroupDefaults(result.group, result.provider)
        }

        return result.group
    }

    private async editProfileGroupDefaults (group: SessionProfileGroup, provider: ProfileProvider<Profile>): Promise<SessionProfileGroup | null> {
        const modal = this.ngbModal.open(EditProfileModalComponent, { size: 'lg' })
        const model = group.defaults?.[provider.id] ?? {}
        model.type = provider.id
        modal.componentInstance.profile = Object.assign({}, model)
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'group'

        const result = await modal.result.catch(() => null)
        if (result) {
            for (const key in model) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete model[key]
            }
            Object.assign(model, result)
            if (!group.defaults) {
                group.defaults = {}
            }
            group.defaults[provider.id] = model
        }

        return this.showProfileGroupEditModal(group)
    }

    private cleanProfileGroup (group: SessionProfileGroup): PartialProfileGroup<ProfileGroup> {
        const cleaned: any = { ...group }
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleaned.profiles
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleaned.editable
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleaned.collapsed
        return cleaned
    }
}
