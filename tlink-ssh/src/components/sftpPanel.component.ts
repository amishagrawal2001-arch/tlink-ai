import * as C from 'constants'
import { posix as path } from 'path'
import { Component, Input, Output, EventEmitter, Inject, Optional, ElementRef, OnDestroy } from '@angular/core'
import { FileUpload, DirectoryUpload, DirectoryDownload, MenuItemOptions, NotificationsService, PlatformService } from 'tlink-core'
import { SFTPSession, SFTPFile } from '../session/sftp'
import { SSHSession } from '../session/ssh'
import { SFTPContextMenuItemProvider } from '../api'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SFTPCreateDirectoryModalComponent } from './sftpCreateDirectoryModal.component'

interface PathSegment {
    name: string
    path: string
}

@Component({
    selector: 'sftp-panel',
    templateUrl: './sftpPanel.component.pug',
    styleUrls: ['./sftpPanel.component.scss'],
})
export class SFTPPanelComponent implements OnDestroy {
    @Input() session: SSHSession
    @Output() closed = new EventEmitter<void>()
    sftp: SFTPSession
    fileList: SFTPFile[]|null = null
    filteredFileList: SFTPFile[] = []
    @Input() path = '/'
    @Output() pathChange = new EventEmitter<string>()
    pathSegments: PathSegment[] = []
    @Input() cwdDetectionAvailable = false
    editingPath: string|null = null
    showFilter = false
    filterText = ''
    isNavigating = false // Track if navigation is in progress
    navigationWarning = false // Show warning if operation is taking too long
    private navigationAbortController: AbortController|null = null
    private sftpClosedSubscription: any = null
    private warningTimeoutId: NodeJS.Timeout | null = null
    private resizeStartY: number|null = null
    private resizeStartHeight = 0
    private resizeMoveHandler: ((event: MouseEvent) => void)|null = null
    private resizeUpHandler: (() => void)|null = null

    constructor (
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        public platform: PlatformService,
        private host: ElementRef<HTMLElement>,
        @Optional() @Inject(SFTPContextMenuItemProvider) protected contextMenuProviders: SFTPContextMenuItemProvider[],
    ) {
        this.contextMenuProviders.sort((a, b) => a.weight - b.weight)
    }

    async ngOnInit (): Promise<void> {
        try {
            this.sftp = await this.session.openSFTP()
            
            // Subscribe to SFTP session closure to prevent hanging operations
            this.sftpClosedSubscription = this.sftp.closed$.subscribe(() => {
                if (this.isNavigating) {
                    this.isNavigating = false
                    if (this.navigationAbortController) {
                        this.navigationAbortController.abort()
                        this.navigationAbortController = null
                    }
                    this.notifications.error('SFTP session was closed')
                }
            })
        } catch (error) {
            const message = error?.message ?? 'Failed to open SFTP session.'
            console.warn('Failed to open SFTP session:', error)
            this.notifications.error(message)
            this.closed.emit()
            return
        }

        try {
            await this.navigate(this.path)
        } catch (error) {
            console.warn('Could not navigate to', this.path, ':', error)
            this.notifications.error(error.message)
            await this.navigate('/')
        }
    }

    ngOnDestroy (): void {
        this.stopResize()
        // Cancel any ongoing navigation
        if (this.navigationAbortController) {
            this.navigationAbortController.abort()
            this.navigationAbortController = null
        }
        // Clear all timeouts
        if (this.warningTimeoutId) {
            clearTimeout(this.warningTimeoutId)
            this.warningTimeoutId = null
        }
        this.isNavigating = false
        this.navigationWarning = false
        // Unsubscribe from SFTP closed events
        if (this.sftpClosedSubscription) {
            this.sftpClosedSubscription.unsubscribe()
            this.sftpClosedSubscription = null
        }
    }

    async navigate (newPath: string, fallbackOnError = true): Promise<void> {
        // Cancel any ongoing navigation
        if (this.navigationAbortController) {
            this.navigationAbortController.abort()
        }
        this.navigationAbortController = new AbortController()
        const abortSignal = this.navigationAbortController.signal

        // Validate path before proceeding
        if (!newPath || typeof newPath !== 'string' || newPath.trim() === '') {
            this.notifications.error('Invalid path provided')
            this.isNavigating = false
            this.navigationAbortController = null
            return
        }

        // Check if SFTP session is available
        if (!this.sftp) {
            this.notifications.error('SFTP session is not available')
            this.isNavigating = false
            this.navigationAbortController = null
            return
        }

        this.isNavigating = true
        const previousPath = this.path
        
        // Normalize path
        const normalizedPath = newPath.trim()
        this.path = normalizedPath
        this.pathChange.next(this.path)
        
        // Force UI update to show loading state immediately
        // Use setTimeout to ensure the UI updates before the blocking operation
        await new Promise(resolve => setTimeout(resolve, 0))

        this.clearFilter()

        let p = newPath
        this.pathSegments = []
        while (p !== '/') {
            this.pathSegments.unshift({
                name: path.basename(p),
                path: p,
            })
            p = path.dirname(p)
        }

        this.fileList = null
        this.filteredFileList = []

        let timeoutId: NodeJS.Timeout | null = null
        let readdirPromise: Promise<SFTPFile[]> | null = null
        
        try {
            // Double-check SFTP session is still available
            if (!this.sftp) {
                throw new Error('SFTP session is not available')
            }
            
            // Check if navigation was aborted before starting
            if (abortSignal.aborted) {
                this.isNavigating = false
                this.navigationAbortController = null
                return
            }
            
            // Show warning after 2 seconds if operation is still pending
            this.navigationWarning = false
            this.warningTimeoutId = setTimeout(() => {
                if (this.isNavigating && !abortSignal.aborted) {
                    this.navigationWarning = true
                }
            }, 2000) // Show warning after 2 seconds
            
            // Add timeout wrapper around readdir to prevent hanging
            // Start the readdir operation
            readdirPromise = this.sftp.readdir(this.path)
            
            // Create timeout promise that will reject after 5 seconds
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    // Force rejection even if readdir is still pending
                    reject(new Error(`SFTP operation timed out after 5 seconds. The path "${this.path}" may be invalid or the server is unresponsive. Please check the path and try again.`))
                }, 5000) // 5 second timeout
            })

            // Use Promise.race to ensure timeout works - this will reject if timeout occurs
            // Wrap both promises to ensure proper cleanup
            const wrappedReaddir = readdirPromise.then(result => {
                // Clear timeouts if readdir succeeded
                if (timeoutId) {
                    clearTimeout(timeoutId)
                    timeoutId = null
                }
                if (this.warningTimeoutId) {
                    clearTimeout(this.warningTimeoutId)
                    this.warningTimeoutId = null
                }
                this.navigationWarning = false
                return result
            }).catch(err => {
                // Clear timeouts on error
                if (timeoutId) {
                    clearTimeout(timeoutId)
                    timeoutId = null
                }
                if (this.warningTimeoutId) {
                    clearTimeout(this.warningTimeoutId)
                    this.warningTimeoutId = null
                }
                this.navigationWarning = false
                throw err
            })
            
            const wrappedTimeout = timeoutPromise.catch(err => {
                // Timeout triggered - ensure cleanup
                if (timeoutId) {
                    clearTimeout(timeoutId)
                    timeoutId = null
                }
                if (this.warningTimeoutId) {
                    clearTimeout(this.warningTimeoutId)
                    this.warningTimeoutId = null
                }
                this.navigationWarning = false
                throw err
            })
            
            const result = await Promise.race([wrappedReaddir, wrappedTimeout])
            
            // Check if navigation was aborted (double-check after await)
            if (abortSignal.aborted || !this.sftp) {
                this.isNavigating = false
                this.navigationAbortController = null
                return
            }
            
            // Verify we got a valid result
            if (!result || !Array.isArray(result)) {
                throw new Error('Invalid response from SFTP server')
            }
            
            this.fileList = result
        } catch (error) {
            // Clear all timeouts in case of error
            if (timeoutId) {
                clearTimeout(timeoutId)
                timeoutId = null
            }
            if (this.warningTimeoutId) {
                clearTimeout(this.warningTimeoutId)
                this.warningTimeoutId = null
            }
            this.navigationWarning = false
            
            // Don't show error if navigation was cancelled
            if (abortSignal.aborted) {
                this.isNavigating = false
                this.navigationAbortController = null
                return
            }
            
            // Force UI update to show error state
            await new Promise(resolve => setTimeout(resolve, 0))
            
            const errorMessage = error?.message ?? 'Failed to read directory'
            this.notifications.error(errorMessage)
            
            // Reset to previous path if available
            if (previousPath && fallbackOnError && previousPath !== this.path) {
                // Reset navigating flag before recursive call
                this.isNavigating = false
                this.navigationAbortController = null
                // Use setTimeout to allow UI to update before navigating back
                setTimeout(() => {
                    this.navigate(previousPath, false).catch(() => {
                        // Ignore errors in fallback navigation
                    })
                }, 100)
                return
            }
            this.isNavigating = false
            this.navigationAbortController = null
            return
        } finally {
            // Ensure all timeouts are cleared
            if (timeoutId) {
                clearTimeout(timeoutId)
                timeoutId = null
            }
            if (this.warningTimeoutId) {
                clearTimeout(this.warningTimeoutId)
                this.warningTimeoutId = null
            }
        }

        // Check again if navigation was aborted after readdir
        if (abortSignal.aborted) {
            this.isNavigating = false
            this.navigationAbortController = null
            return
        }

        const dirKey = a => a.isDirectory ? 1 : 0
        this.fileList.sort((a, b) =>
            dirKey(b) - dirKey(a) ||
            a.name.localeCompare(b.name))

        this.updateFilteredList()
        this.isNavigating = false
        this.navigationWarning = false
        this.navigationAbortController = null
    }

    getFileType (fileExtension: string): string {
        const codeExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'h', 'cs', 'html', 'css', 'rb', 'php', 'swift', 'go', 'kt', 'sh', 'json', 'cc', 'c', 'xml']
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp']
        const pdfExtensions = ['pdf']
        const archiveExtensions = ['zip', 'rar', 'tar', 'gz']
        const wordExtensions = ['doc', 'docx']
        const videoExtensions = ['mp4', 'avi', 'mkv', 'mov']
        const powerpointExtensions = ['ppt', 'pptx']
        const textExtensions = ['txt', 'log']
        const audioExtensions = ['mp3', 'wav', 'flac']
        const excelExtensions = ['xls', 'xlsx']

        const lowerCaseExtension = fileExtension.toLowerCase()

        if (codeExtensions.includes(lowerCaseExtension)) {
            return 'code'
        } else if (imageExtensions.includes(lowerCaseExtension)) {
            return 'image'
        } else if (pdfExtensions.includes(lowerCaseExtension)) {
            return 'pdf'
        } else if (archiveExtensions.includes(lowerCaseExtension)) {
            return 'archive'
        } else if (wordExtensions.includes(lowerCaseExtension)) {
            return 'word'
        } else if (videoExtensions.includes(lowerCaseExtension)) {
            return 'video'
        } else if (powerpointExtensions.includes(lowerCaseExtension)) {
            return 'powerpoint'
        } else if (textExtensions.includes(lowerCaseExtension)) {
            return 'text'
        } else if (audioExtensions.includes(lowerCaseExtension)) {
            return 'audio'
        } else if (excelExtensions.includes(lowerCaseExtension)) {
            return 'excel'
        } else {
            return 'unknown'
        }
    }

    startResize (event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()

        this.resizeStartY = event.clientY
        this.resizeStartHeight = this.host.nativeElement.getBoundingClientRect().height

        this.resizeMoveHandler = (moveEvent: MouseEvent) => {
            if (this.resizeStartY === null) {
                return
            }
            const delta = this.resizeStartY - moveEvent.clientY
            const parentHeight = this.host.nativeElement.parentElement?.getBoundingClientRect().height ?? window.innerHeight
            const minHeight = 200
            const maxHeight = Math.round(parentHeight * 0.95)
            const nextHeight = Math.max(minHeight, Math.min(maxHeight, this.resizeStartHeight + delta))
            this.host.nativeElement.style.height = `${Math.round(nextHeight)}px`
        }

        this.resizeUpHandler = () => this.stopResize()
        document.addEventListener('mousemove', this.resizeMoveHandler)
        document.addEventListener('mouseup', this.resizeUpHandler)
    }

    private stopResize (): void {
        if (this.resizeMoveHandler) {
            document.removeEventListener('mousemove', this.resizeMoveHandler)
        }
        if (this.resizeUpHandler) {
            document.removeEventListener('mouseup', this.resizeUpHandler)
        }
        this.resizeMoveHandler = null
        this.resizeUpHandler = null
        this.resizeStartY = null
    }

    getIcon (item: SFTPFile): string {
        if (item.isDirectory) {
            return 'fas fa-folder text-info'
        }
        if (item.isSymlink) {
            return 'fas fa-link text-warning'
        }
        const fileMatch = /\.([^.]+)$/.exec(item.name)
        const extension = fileMatch ? fileMatch[1] : null
        if (extension !== null) {
            const fileType = this.getFileType(extension)

            switch (fileType) {
                case 'unknown':
                    return 'fas fa-file'
                default:
                    return `fa-solid fa-file-${fileType} `
            }
        }
        return 'fas fa-file'
    }

    goUp (): void {
        this.navigate(path.dirname(this.path))
    }

    async open (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            await this.navigate(item.fullPath)
        } else if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.navigate(item.fullPath)
            } else {
                await this.download(item.fullPath, stat.mode, stat.size)
            }
        } else {
            await this.download(item.fullPath, item.mode, item.size)
        }
    }

    async openCreateDirectoryModal (): Promise<void> {
        const modal = this.ngbModal.open(SFTPCreateDirectoryModalComponent)
        const directoryName = await modal.result.catch(() => null)
        if (directoryName?.trim()) {
            this.sftp.mkdir(path.join(this.path, directoryName)).then(() => {
                this.notifications.notice('The directory was created successfully')
                this.navigate(path.join(this.path, directoryName))
            }).catch(() => {
                this.notifications.error('The directory could not be created')
            })
        }
    }

    async upload (): Promise<void> {
        const transfers = await this.platform.startUpload({ multiple: true })
        await Promise.all(transfers.map(t => this.uploadOne(t)))
    }

    async uploadFolder (): Promise<void> {
        const transfer = await this.platform.startUploadDirectory()
        await this.uploadOneFolder(transfer)
    }

    async uploadOneFolder (transfer: DirectoryUpload, accumPath = ''): Promise<void> {
        const savedPath = this.path
        for(const t of transfer.getChildrens()) {
            if (t instanceof DirectoryUpload) {
                try {
                    await this.sftp.mkdir(path.posix.join(this.path, accumPath, t.getName()))
                } catch {
                    // Intentionally ignoring errors from making duplicate dirs.
                }
                await this.uploadOneFolder(t, path.posix.join(accumPath, t.getName()))
            } else {
                await this.sftp.upload(path.posix.join(this.path, accumPath, t.getName()), t)
            }
        }
        if (this.path === savedPath) {
            await this.navigate(this.path)
        }
    }

    async uploadOne (transfer: FileUpload): Promise<void> {
        const savedPath = this.path
        await this.sftp.upload(path.join(this.path, transfer.getName()), transfer)
        if (this.path === savedPath) {
            await this.navigate(this.path)
        }
    }

    async download (itemPath: string, mode: number, size: number): Promise<void> {
        const transfer = await this.platform.startDownload(path.basename(itemPath), mode, size)
        if (!transfer) {
            return
        }
        this.sftp.download(itemPath, transfer)
    }

    async downloadFolder (folder: SFTPFile): Promise<void> {
        try {
            const transfer = await this.platform.startDownloadDirectory(folder.name, 0)
            if (!transfer) {
                return
            }

            // Start background size calculation and download simultaneously
            const sizeCalculationPromise = this.calculateFolderSizeAndUpdate(folder, transfer)
            const downloadPromise = this.downloadFolderRecursive(folder, transfer, '')

            try {
                await Promise.all([sizeCalculationPromise, downloadPromise])
                transfer.setStatus('')
                transfer.setCompleted(true)
            } catch (error) {
                transfer.cancel()
                throw error
            } finally {
                transfer.close()
            }
        } catch (error) {
            this.notifications.error(`Failed to download folder: ${error.message}`)
            throw error
        }
    }

    private async calculateFolderSizeAndUpdate (folder: SFTPFile, transfer: DirectoryDownload) {
        let totalSize = 0
        const items = await this.sftp.readdir(folder.fullPath)
        for (const item of items) {
            if (item.isDirectory) {
                totalSize += await this.calculateFolderSizeAndUpdate(item, transfer)
            } else {
                totalSize += item.size
            }
            transfer.setTotalSize(totalSize)
        }
        return totalSize
    }

    private async downloadFolderRecursive (folder: SFTPFile, transfer: DirectoryDownload, relativePath: string): Promise<void> {
        const items = await this.sftp.readdir(folder.fullPath)

        for (const item of items) {
            if (transfer.isCancelled()) {
                throw new Error('Download cancelled')
            }

            const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name

            transfer.setStatus(itemRelativePath)
            if (item.isDirectory) {
                await transfer.createDirectory(itemRelativePath)
                await this.downloadFolderRecursive(item, transfer, itemRelativePath)
            } else {
                const fileDownload = await transfer.createFile(itemRelativePath, item.mode, item.size)
                await this.sftp.download(item.fullPath, fileDownload)
            }
        }
    }

    getModeString (item: SFTPFile): string {
        const s = 'SGdrwxrwxrwx'
        const e = '   ---------'
        const c = [
            0o4000, 0o2000, C.S_IFDIR,
            C.S_IRUSR, C.S_IWUSR, C.S_IXUSR,
            C.S_IRGRP, C.S_IWGRP, C.S_IXGRP,
            C.S_IROTH, C.S_IWOTH, C.S_IXOTH,
        ]
        let result = ''
        for (let i = 0; i < c.length; i++) {
            result += item.mode & c[i] ? s[i] : e[i]
        }
        return result
    }

    async buildContextMenu (item: SFTPFile): Promise<MenuItemOptions[]> {
        let items: MenuItemOptions[] = []
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(item, this)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        return items.slice(1)
    }

    async showContextMenu (item: SFTPFile, event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.platform.popupContextMenu(await this.buildContextMenu(item), event)
    }

    get shouldShowCWDTip (): boolean {
        return !window.localStorage.sshCWDTipDismissed
    }

    dismissCWDTip (): void {
        window.localStorage.sshCWDTipDismissed = 'true'
    }

    editPath (): void {
        this.editingPath = this.path
    }

    async confirmPath (): Promise<void> {
        if (this.editingPath === null) {
            return
        }
        const pathToNavigate = this.editingPath
        this.editingPath = null // Clear editing state immediately for better UX
        try {
            await this.navigate(pathToNavigate)
        } catch (error) {
            // Error already handled in navigate()
        }
    }

    close (): void {
        this.closed.emit()
    }

    clearFilter (): void {
        this.showFilter = false
        this.filterText = ''
        this.updateFilteredList()
    }

    onFilterChange (): void {
        this.updateFilteredList()
    }

    private updateFilteredList (): void {
        if (!this.fileList) {
            this.filteredFileList = []
            return
        }

        if (!this.showFilter || this.filterText.trim() === '') {
            this.filteredFileList = this.fileList
            return
        }

        this.filteredFileList = this.fileList.filter(item =>
            item.name.toLowerCase().includes(this.filterText.toLowerCase()),
        )
    }
}
