import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostBinding, HostListener, Injector, ViewChild, Optional } from '@angular/core'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'

import { BaseTabComponent, GetRecoveryTokenOptions, PlatformService, RecoveryToken } from '../api'
import { AppService } from '../services/app.service'
import { TabsService } from '../services/tabs.service'
import { ProfilesService } from '../services/profiles.service'
import { SplitTabComponent } from './splitTab.component'
import type { TerminalService as TerminalServiceType } from 'tlink-local'
import type { BaseTerminalTabComponent as BaseTerminalTabComponentType } from 'tlink-terminal'
import { PromptModalComponent } from './promptModal.component'

type Monaco = any

interface EditorDocumentSnapshot {
    name: string
    path: string|null
    tempPath?: string|null
    folderPath?: string|null
    content: string
    languageId: string
    eol: 'LF'|'CRLF'
    tabSize: number
    insertSpaces: boolean
    isDirty?: boolean
    lastSavedValue?: string
}

interface EditorDocument extends EditorDocumentSnapshot {
    id: string
    model: any
    tempPath?: string|null
    folderPath?: string|null
    isDirty: boolean
    lastSavedValue: string
    ansiDecorationIds: string[]
}

type ViewMode = 'editor'|'diff'
interface TreeNode {
    name: string
    path: string
    isFolder: boolean
    children: TreeNode[]
    docId?: string|null
    folderPath?: string|null
}
interface CodeFolder {
    name: string
    path: string
}

@Component({
    selector: 'code-editor-tab',
    templateUrl: './codeEditorTab.component.pug',
    styleUrls: ['./codeEditorTab.component.scss'],
})
export class CodeEditorTabComponent extends BaseTabComponent implements AfterViewInit {
    @HostBinding('class.code-editor-tab') hostClass = true
    @ViewChild('primaryHost', { static: true }) primaryHost?: ElementRef<HTMLDivElement>
    @ViewChild('splitHost', { static: true }) splitHost?: ElementRef<HTMLDivElement>
    @ViewChild('diffHost', { static: true }) diffHost?: ElementRef<HTMLDivElement>

    loading = true
    loadError: string|null = null
    documents: EditorDocument[] = []
    activeDocId: string|null = null
    splitDocId: string|null = null
    recentFiles: string[] = []
    closedDocuments: EditorDocumentSnapshot[] = []
    editingDocId: string|null = null
    editingDocName = ''
    wordWrapEnabled = false
    minimapEnabled = false
    themeMode: 'auto'|'light'|'dark'|'hc' = 'auto'
    fontSize = 14
    lineHeight = 22
    autosaveEnabled = true
    autosaveIntervalMs = 15000
    viewMode: ViewMode = 'editor'
    breadcrumbs: string[] = []
    statusMessage = ''
    runArgs = ''
    sidebarWidth = 240
    private runTerminalTab: BaseTerminalTabComponentType<any>|null = null
    pendingDiffDocId: string|null = null
    fileMenuOpen = false
    editMenuOpen = false
    docContextMenuOpen = false
    docContextMenuDocId: string|null = null
    docContextMenuX = 0
    docContextMenuY = 0
    folders: CodeFolder[] = []
    selectedFolderPath: string|null = null
    folderContextMenuOpen = false
    folderContextMenuPath: string|null = null
    folderContextMenuX = 0
    folderContextMenuY = 0
    fileContextMenuOpen = false
    fileContextMenuPath: string|null = null
    fileContextMenuX = 0
    fileContextMenuY = 0
    private draggingDocId: string|null = null
    private draggingPath: string|null = null
    private draggingIsFolder = false
    expandedFolders = new Set<string>()
    private _treeItems: Array<{ node: TreeNode, depth: number }> = []

    get hasRunTerminal (): boolean {
        return !!this.runTerminalTab
    }

    statusLineCol = ''
    statusLanguage = ''
    statusEOL = ''
    statusIndent = ''
    statusEncoding = 'UTF-8'
    statusWrap = ''

    private monaco?: Monaco
    private monacoPromise?: Promise<Monaco>
    private monacoAmdRequire?: any
    private monacoBase = this.resolveMonacoBase()
    private folderRoot = this.getFolderRoot()
    private primaryEditor: any
    splitEditor: any
    private diffEditor: any
    private diffOriginalModel: any
    private autosaveTimer?: number
    private externalOpenHandler?: (e: Event) => void
    private tempSaveTimers = new Map<string, number>()
    private focusedEditor: 'primary'|'split' = 'primary'
    private pendingSplitDocId: string|null = null
    private resizingSidebar = false
    private resizeStartX = 0
    private resizeStartWidth = 0

    private getFolderRoot (): string {
        const home = process.env.TLINK_CONFIG_DIR || process.env.HOME || os.homedir()
        const dir = path.join(home || os.tmpdir(), '.tlink', 'code-editor')
        if (!fsSync.existsSync(dir)) {
            try {
                fsSync.mkdirSync(dir, { recursive: true })
            } catch {
                return os.tmpdir()
            }
        }
        return dir
    }

    private loadFoldersFromState (): void {
        let paths: string[] = []
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('codeEditor.folders')
            if (stored) {
                try {
                    paths = JSON.parse(stored) ?? []
                } catch {
                    paths = []
                }
            }
        }
        if (!paths.includes(this.folderRoot)) {
            paths.unshift(this.folderRoot)
        }
        const existing = paths.filter(p => p && fsSync.existsSync(p) && fsSync.statSync(p).isDirectory())
        const unique: string[] = []
        for (const p of existing) {
            if (!unique.includes(p)) {
                unique.push(p)
            }
        }
        this.folders = unique.map(p => ({ path: p, name: path.basename(p) || 'Folder' }))
        const savedSelected = typeof localStorage !== 'undefined' ? localStorage.getItem('codeEditor.selectedFolder') : null
        this.selectedFolderPath = savedSelected && unique.includes(savedSelected) ? savedSelected : null
        if (typeof localStorage !== 'undefined') {
            const storedExpanded = localStorage.getItem('codeEditor.expandedFolders')
            if (storedExpanded) {
                try {
                    this.expandedFolders = new Set(JSON.parse(storedExpanded) ?? [])
                } catch {
                    this.expandedFolders = new Set()
                }
            }
        }
        if (!this.expandedFolders.size) {
            for (const f of this.folders) {
                this.expandedFolders.add(f.path)
            }
        }
        // Don't call updateTreeItems here - it will be called in ngAfterViewInit
        // to avoid ExpressionChangedAfterItHasBeenCheckedError
    }

    private persistFolders (): void {
        if (typeof localStorage === 'undefined') {
            return
        }
        localStorage.setItem('codeEditor.folders', JSON.stringify(this.folders.map(f => f.path)))
        localStorage.setItem('codeEditor.selectedFolder', this.selectedFolderPath ?? '')
        localStorage.setItem('codeEditor.expandedFolders', JSON.stringify(Array.from(this.expandedFolders)))
    }

    selectFolder (folderPath: string|null): void {
        this.selectedFolderPath = folderPath
        this.persistFolders()
    }

    private resolveDocFolder (doc: EditorDocument): string|null {
        return doc.folderPath ?? this.getFolderForPath(doc.path)
    }

    getDocById (docId: string): EditorDocument|null {
        return this.documents.find(d => d.id === docId) ?? null
    }

    private getFolderForPath (filePath: string|null): string|null {
        if (!filePath) {
            return null
        }
        const normalized = path.resolve(filePath)
        for (const folder of this.folders) {
            const folderResolved = path.resolve(folder.path)
            if (normalized === folderResolved || normalized.startsWith(folderResolved + path.sep)) {
                return folder.path
            }
        }
        return null
    }

    private buildTree (): TreeNode[] {
        const docsByPath = new Map<string, EditorDocument>()
        for (const doc of this.documents) {
            if (doc.path) {
                docsByPath.set(path.resolve(doc.path), doc)
            }
        }

        const readDir = (dir: string): TreeNode[] => {
            try {
                const entries = fsSync.readdirSync(dir, { withFileTypes: true }) as any[]
                const nodes: TreeNode[] = []
                for (const entry of entries) {
                    const name = entry?.name
                    if (!name || name === '.' || name === '..') {
                        continue
                    }
                    const fullPath = path.join(dir, name)
                    const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false
                    if (isDir) {
                        nodes.push({
                            name,
                            path: fullPath,
                            isFolder: true,
                            children: [],
                            folderPath: fullPath,
                        })
                    } else {
                        const doc = docsByPath.get(path.resolve(fullPath)) ?? null
                        nodes.push({
                            name,
                            path: fullPath,
                            isFolder: false,
                            children: [],
                            docId: doc?.id ?? null,
                            folderPath: dir,
                        })
                    }
                }
                nodes.sort((a, b) => {
                    if (a.isFolder !== b.isFolder) {
                        return a.isFolder ? -1 : 1
                    }
                    return a.name.localeCompare(b.name)
                })
                return nodes
            } catch {
                return []
            }
        }

        const populate = (node: TreeNode): void => {
            if (!node.isFolder) {
                return
            }
            const key = node.path || ''
            if (!this.expandedFolders.has(key)) {
                node.children = []
                return
            }
            node.children = readDir(node.path)
            for (const child of node.children) {
                if (child.isFolder) {
                    populate(child)
                }
            }
        }

        const roots: TreeNode[] = []

        for (const folder of this.folders) {
            const root: TreeNode = {
                name: folder.name,
                path: folder.path,
                isFolder: true,
                children: [],
                folderPath: folder.path,
            }
            populate(root)
            roots.push(root)
        }

        return roots
    }

    async addFolder (): Promise<void> {
        const name = (await this.promptForName('New folder name', 'Folder'))?.trim()
        if (!name) {
            return
        }
        if (/[\\/]/.test(name)) {
            this.setError('Folder name cannot contain slashes')
            return
        }
        const target = path.join(this.folderRoot, name)
        if (fsSync.existsSync(target) && !fsSync.statSync(target).isDirectory()) {
            this.setError('A file with that name already exists')
            return
        }
        if (!fsSync.existsSync(target)) {
            try {
                await fs.mkdir(target, { recursive: true })
            } catch (err: any) {
                this.setError(`Cannot create folder: ${err?.message ?? err}`)
                return
            }
        }
        if (!this.folders.find(f => f.path === target)) {
            this.folders.push({ name, path: target })
        }
        this.selectFolder(target)
        this.persistFolders()
        this.expandedFolders.add(target)
        this.updateTreeItems()
        window.setTimeout(() => this.cdr.markForCheck(), 0)
    }

    async openFolderFromDisk (): Promise<void> {
        const input = await this.promptForName('Enter folder path', this.folderRoot)
        const folderPath = (input ?? '').trim()
        if (!folderPath) {
            return
        }
        if (!fsSync.existsSync(folderPath) || !fsSync.statSync(folderPath).isDirectory()) {
            this.setError('Folder does not exist')
            return
        }
        if (!this.folders.find(f => f.path === folderPath)) {
            this.folders.push({ name: path.basename(folderPath) || folderPath, path: folderPath })
        }
        this.selectFolder(folderPath)
        this.persistFolders()
        this.expandedFolders.add(folderPath)
    }

    async renameFolder (folderPath: string): Promise<void> {
        const folder = this.folders.find(f => f.path === folderPath)
        if (!folder) {
            return
        }
        const nextName = (await this.promptForName('Rename folder', folder.name))?.trim()
        if (!nextName || nextName === folder.name) {
            return
        }
        if (/[\\/]/.test(nextName)) {
            this.setError('Folder name cannot contain slashes')
            return
        }
        const parent = path.dirname(folder.path)
        const newPath = path.join(parent, nextName)
        if (fsSync.existsSync(newPath)) {
            this.setError('A folder with that name already exists')
            return
        }
        try {
            await fs.rename(folder.path, newPath)
            this.updatePathsForFolderRename(folder.path, newPath)
            folder.path = newPath
            folder.name = nextName
            if (this.selectedFolderPath === folderPath) {
                this.selectedFolderPath = newPath
            }
            if (this.expandedFolders.has(folderPath)) {
                this.expandedFolders.delete(folderPath)
                this.expandedFolders.add(newPath)
            }
            this.persistFolders()
            this.persistState()
            this.updateTreeItems()
            window.setTimeout(() => this.cdr.markForCheck(), 0)
        } catch (err: any) {
            this.setError(`Failed to rename folder: ${err?.message ?? err}`)
        }
    }

    private async updatePathsForFolderRename (oldPath: string, newPath: string): Promise<void> {
        for (const doc of this.documents) {
            const folderPath = this.resolveDocFolder(doc)
            if (folderPath === oldPath) {
                doc.folderPath = newPath
            }
            if (doc.path && doc.path.startsWith(oldPath)) {
                const rel = path.relative(oldPath, doc.path)
                const dest = path.join(newPath, rel)
                try {
                    await fs.mkdir(path.dirname(dest), { recursive: true })
                    await fs.rename(doc.path, dest)
                    doc.path = dest
                    doc.name = path.basename(dest)
                } catch {
                    // leave as-is on failure
                }
            } else if (!doc.path && doc.tempPath && doc.tempPath.startsWith(oldPath)) {
                const rel = path.relative(oldPath, doc.tempPath)
                const dest = path.join(newPath, rel)
                try {
                    await fs.mkdir(path.dirname(dest), { recursive: true })
                    await fs.rename(doc.tempPath, dest)
                    doc.tempPath = dest
                } catch {
                    // ignore temp move errors
                }
            }
        }
    }

    removeFolder (folderPath: string): void {
        this.folders = this.folders.filter(f => f.path !== folderPath)
        if (this.selectedFolderPath === folderPath) {
            this.selectedFolderPath = null
        }
        this.expandedFolders.delete(folderPath)
        this.persistFolders()
        this.updateTreeItems()
        window.setTimeout(() => this.cdr.markForCheck(), 0)
    }

    openFolderContextMenu (event: MouseEvent, folderPath: string): void {
        if (!folderPath) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        this.folderContextMenuOpen = true
        this.folderContextMenuPath = folderPath
        const menuWidth = 220
        const menuHeight = 120
        const padding = 8
        const maxX = Math.max(padding, (window.innerWidth || 0) - menuWidth - padding)
        const maxY = Math.max(padding, (window.innerHeight || 0) - menuHeight - padding)
        this.folderContextMenuX = Math.max(padding, Math.min(event.clientX, maxX))
        this.folderContextMenuY = Math.max(padding, Math.min(event.clientY, maxY))
    }

    openFileContextMenu (event: MouseEvent, filePath: string): void {
        event.preventDefault()
        event.stopPropagation()
        this.fileContextMenuOpen = true
        this.fileContextMenuPath = filePath
        const menuWidth = 220
        const menuHeight = 140
        const padding = 8
        const maxX = Math.max(padding, (window.innerWidth || 0) - menuWidth - padding)
        const maxY = Math.max(padding, (window.innerHeight || 0) - menuHeight - padding)
        this.fileContextMenuX = Math.max(padding, Math.min(event.clientX, maxX))
        this.fileContextMenuY = Math.max(padding, Math.min(event.clientY, maxY))
    }

    async handleFolderContextAction (action: string): Promise<void> {
        const folderPath = this.folderContextMenuPath
        this.folderContextMenuOpen = false
        this.folderContextMenuPath = null
        if (!folderPath) {
            return
        }
        if (action === 'newFolder') {
            await this.createFolderInFolder(folderPath)
        } else if (action === 'newFile') {
            await this.createFileInFolder(folderPath)
        } else if (action === 'rename') {
            if (this.folders.find(f => f.path === folderPath)) {
                await this.renameFolder(folderPath)
            } else {
                await this.renameFolderOnDisk(folderPath)
            }
        } else if (action === 'remove') {
            if (this.folders.find(f => f.path === folderPath)) {
                this.removeFolder(folderPath)
            }
        } else if (action === 'open') {
            try {
                this.platform.showItemInFolder(folderPath)
            } catch {
                // ignore
            }
        } else if (action === 'delete') {
            await this.deleteFolderOnDisk(folderPath)
        }
    }

    async handleFileContextAction (action: string): Promise<void> {
        const filePath = this.fileContextMenuPath
        this.fileContextMenuOpen = false
        this.fileContextMenuPath = null
        if (!filePath) {
            return
        }
        if (action === 'open') {
            await this.openFileFromDiskPath(filePath)
        } else if (action === 'rename') {
            await this.renameFileOnDisk(filePath)
        } else if (action === 'show') {
            try {
                this.platform.showItemInFolder(filePath)
            } catch {}
        } else if (action === 'delete') {
            await this.deleteFileOnDisk(filePath)
        }
    }

    private async openFileFromDiskPath (filePath: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf8')
            this.openDocumentFromContent(path.basename(filePath), filePath, content)
        } catch (err: any) {
            this.setError(`Failed to open file: ${err?.message ?? err}`)
        }
    }

    private async createFolderInFolder (parentFolder: string): Promise<void> {
        const name = (await this.promptForName('New folder name', 'Folder'))?.trim()
        if (!name) {
            return
        }
        if (/[\\/]/.test(name)) {
            this.setError('Folder name cannot contain slashes')
            return
        }
        const target = path.join(parentFolder, name)
        try {
            await fs.mkdir(target, { recursive: false })
            this.expandedFolders.add(parentFolder)
            this.persistFolders()
            this.updateTreeItems()
            window.setTimeout(() => this.cdr.markForCheck(), 0)
        } catch (err: any) {
            this.setError(`Cannot create folder: ${err?.message ?? err}`)
        }
    }

    private async createFileInFolder (parentFolder: string): Promise<void> {
        const name = (await this.promptForName('New file name', 'file.txt'))?.trim()
        if (!name) {
            return
        }
        if (/[\\/]/.test(name)) {
            this.setError('File name cannot contain slashes')
            return
        }
        const target = path.join(parentFolder, name)
        if (fsSync.existsSync(target)) {
            this.setError('A file with that name already exists')
            return
        }
        try {
            await fs.writeFile(target, '', 'utf8')
            this.openDocumentFromContent(path.basename(target), target, '')
            this.expandedFolders.add(parentFolder)
            this.persistFolders()
            this.updateTreeItems()
            window.setTimeout(() => this.cdr.markForCheck(), 0)
        } catch (err: any) {
            this.setError(`Cannot create file: ${err?.message ?? err}`)
        }
    }

    private async renameFolderOnDisk (folderPath: string): Promise<void> {
        const nextName = (await this.promptForName('Rename folder', path.basename(folderPath) || folderPath))?.trim()
        if (!nextName) {
            return
        }
        if (/[\\/]/.test(nextName)) {
            this.setError('Folder name cannot contain slashes')
            return
        }
        const parent = path.dirname(folderPath)
        const newPath = path.join(parent, nextName)
        if (fsSync.existsSync(newPath)) {
            this.setError('A folder with that name already exists')
            return
        }
        try {
            await fs.rename(folderPath, newPath)
            if (this.selectedFolderPath === folderPath) {
                this.selectedFolderPath = newPath
            }
            if (this.expandedFolders.has(folderPath)) {
                this.expandedFolders.delete(folderPath)
                this.expandedFolders.add(newPath)
            }
            this.updatePathsForFolderRename(folderPath, newPath)
            this.persistFolders()
            this.updateTreeItems()
            window.setTimeout(() => this.cdr.markForCheck(), 0)
        } catch (err: any) {
            this.setError(`Failed to rename folder: ${err?.message ?? err}`)
        }
    }

    private async renameFileOnDisk (filePath: string): Promise<void> {
        const nextName = (await this.promptForName('Rename file', path.basename(filePath) || filePath))?.trim()
        if (!nextName) {
            return
        }
        if (/[\\/]/.test(nextName)) {
            this.setError('File name cannot contain slashes')
            return
        }
        const parent = path.dirname(filePath)
        const newPath = path.join(parent, nextName)
        if (fsSync.existsSync(newPath)) {
            this.setError('A file with that name already exists')
            return
        }
        try {
            await fs.rename(filePath, newPath)
            this.updateOpenDocsForFsMove(filePath, newPath, false)
            this.persistState()
        } catch (err: any) {
            this.setError(`Failed to rename file: ${err?.message ?? err}`)
        }
    }

    private async deleteFileOnDisk (filePath: string): Promise<void> {
        const doc = this.documents.find(d => d.path === filePath) ?? null
        if (doc) {
            if (!(await this.confirmDiscard(doc))) {
                return
            }
            await this.closeDocument(doc.id)
        }
        if (!confirm(`Delete ${path.basename(filePath)}?`)) {
            return
        }
        try {
            await fs.unlink(filePath)
            this.persistState()
            this.updateTreeItems()
            window.setTimeout(() => this.cdr.markForCheck(), 0)
        } catch (err: any) {
            this.setError(`Failed to delete file: ${err?.message ?? err}`)
        }
    }

    private async deleteFolderOnDisk (folderPath: string): Promise<void> {
        // Close any open documents in this folder
        const docsInFolder = this.documents.filter(doc => {
            const docFolder = this.resolveDocFolder(doc)
            return docFolder === folderPath || (doc.path && doc.path.startsWith(folderPath + path.sep))
        })
        for (const doc of docsInFolder) {
            if (doc.isDirty && !(await this.confirmDiscard(doc))) {
                return
            }
            await this.closeDocument(doc.id)
        }

        if (!confirm(`Delete folder ${path.basename(folderPath) || folderPath} and all its contents?`)) {
            return
        }
        try {
            // Node 20 supports fs.rm
            await fs.rm(folderPath, { recursive: true, force: false })
            // If it was tracked as a root, remove it from list too
            if (this.folders.find(f => f.path === folderPath)) {
                this.removeFolder(folderPath)
            }
            if (this.selectedFolderPath === folderPath) {
                this.selectedFolderPath = null
            }
            this.expandedFolders.delete(folderPath)
            this.persistFolders()
            this.updateTreeItems()
            window.setTimeout(() => this.cdr.markForCheck(), 0)
        } catch (err: any) {
            this.setError(`Failed to delete folder: ${err?.message ?? err}`)
        }
    }

    private updateOpenDocsForFsMove (oldPath: string, newPath: string, isDir: boolean): void {
        const oldResolved = path.resolve(oldPath)
        const newResolved = path.resolve(newPath)
        for (const doc of this.documents) {
            if (doc.path) {
                const docResolved = path.resolve(doc.path)
                if (isDir) {
                    if (docResolved === oldResolved || docResolved.startsWith(oldResolved + path.sep)) {
                        const rel = path.relative(oldResolved, docResolved)
                        doc.path = path.join(newResolved, rel)
                        doc.name = path.basename(doc.path)
                        doc.folderPath = null
                        this.setModelLanguage(doc)
                    }
                } else if (docResolved === oldResolved) {
                    doc.path = newResolved
                    doc.name = path.basename(doc.path)
                    doc.folderPath = null
                    this.setModelLanguage(doc)
                }
            }
        }
        // Update recents list
        this.recentFiles = this.recentFiles.map(p => p === oldPath ? newPath : p).filter(Boolean)
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('codeEditor.recent', JSON.stringify(this.recentFiles.slice(0, 10)))
        }
    }

    onTreeDragStart (event: DragEvent, node: TreeNode): void {
        this.draggingDocId = node.docId ?? null
        this.draggingPath = node.path || null
        this.draggingIsFolder = !!node.isFolder
        try {
            if (this.draggingDocId) {
                event.dataTransfer?.setData('application/x-tlink-docid', this.draggingDocId)
            }
            if (this.draggingPath) {
                event.dataTransfer?.setData('application/x-tlink-path', this.draggingPath)
            }
            event.dataTransfer?.setData('text/plain', this.draggingPath || this.draggingDocId || '')
            event.dataTransfer?.setDragImage?.(event.target as any, 0, 0)
        } catch {
            // ignore
        }
    }

    onTreeDragEnd (): void {
        this.draggingDocId = null
        this.draggingPath = null
        this.draggingIsFolder = false
    }

    onTreeDragOver (event: DragEvent): void {
        if (this.draggingDocId || this.draggingPath) {
            event.preventDefault()
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'move'
            }
        }
    }

    async onTreeDrop (event: DragEvent, folderPath: string|null): Promise<void> {
        console.log('[CodeEditor] onTreeDrop:', folderPath, 'draggingDocId:', this.draggingDocId, 'draggingPath:', this.draggingPath)
        if (!this.draggingDocId && !this.draggingPath) {
            return
        }
        event.preventDefault()
        event.stopPropagation()

        const targetDir = folderPath || null
        if (!targetDir) {
            return
        }
        try {
            if (!fsSync.existsSync(targetDir) || !fsSync.statSync(targetDir).isDirectory()) {
                return
            }
        } catch {
            return
        }

        // If we're dragging an open document, move it via existing logic (keeps editor model + temp files aligned)
        if (this.draggingDocId) {
            await this.moveDocumentToFolder(this.draggingDocId, targetDir)
            this.draggingDocId = null
            this.draggingPath = null
            this.draggingIsFolder = false
            return
        }

        const sourcePath = this.draggingPath
        const isDir = this.draggingIsFolder
        this.draggingPath = null
        this.draggingIsFolder = false
        if (!sourcePath) {
            return
        }
        if (path.resolve(sourcePath) === path.resolve(targetDir)) {
            return
        }
        const baseName = path.basename(sourcePath)
        const dest = await this.ensureUniquePath(targetDir, baseName)
        try {
            await fs.rename(sourcePath, dest)
            this.updateOpenDocsForFsMove(sourcePath, dest, isDir)
            this.persistState()
        } catch (err: any) {
            this.setError(`Move failed: ${err?.message ?? err}`)
        }
    }

    toggleFolder (event: MouseEvent|null, node: TreeNode): void {
        if (event) {
            event.preventDefault()
            event.stopPropagation()
        }
        if (!node.isFolder) {
            return
        }
        const key = node.path || '__root__'
        const wasExpanded = this.expandedFolders.has(key)
        if (wasExpanded) {
            this.expandedFolders.delete(key)
        } else {
            this.expandedFolders.add(key)
        }
        // Create new Set reference to trigger change detection
        this.expandedFolders = new Set(this.expandedFolders)
        this.persistFolders()
        // Update tree items after state change
        this.updateTreeItems()
        // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
        window.setTimeout(() => {
            this.cdr.markForCheck()
        }, 0)
        // Helpful UX feedback (also acts as a sanity check that click handlers are firing)
        try {
            const nowExpanded = !wasExpanded
            this.statusMessage = `${nowExpanded ? 'Expanded' : 'Collapsed'}: ${node.name}`
            console.log('[CodeEditor] toggleFolder:', node.name, 'wasExpanded:', wasExpanded, 'nowExpanded:', nowExpanded)
            window.setTimeout(() => {
                if (this.statusMessage === `${nowExpanded ? 'Expanded' : 'Collapsed'}: ${node.name}`) {
                    this.statusMessage = ''
                }
            }, 1200)
        } catch {
            // ignore
        }
    }

    async onTreeClick (event: MouseEvent, node: TreeNode): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        console.log('[CodeEditor] onTreeClick:', node.name, 'isFolder:', node.isFolder, 'target:', (event?.target as any)?.className)
        // Don't toggle if clicking on chevron (chevron has its own handler)
        if ((event?.target as any)?.classList?.contains('chevron')) {
            return
        }
        if (node.isFolder) {
            this.selectFolder(node.path || null)
            this.toggleFolder(event, node)
            return
        }
        if (node.docId) {
            this.activateDoc(node.docId)
            return
        }

        const filePath = node.path
        if (!filePath) {
            return
        }
        try {
            const stat = fsSync.statSync(filePath)
            if (!stat.isFile()) {
                return
            }
        } catch {
            return
        }
        await this.openFileFromDiskPath(filePath)
    }

    onTreeDblClick (event: MouseEvent, node: TreeNode): void {
        if (node.isFolder) {
            event.stopPropagation()
            this.toggleFolder(event, node)
            return
        }
        if (!node.isFolder && node.docId) {
            this.startInlineRename(event, node.docId)
        }
    }

    onTreeContextMenu (event: MouseEvent, node: TreeNode): void {
        event.preventDefault()
        event.stopPropagation()
        console.log('[CodeEditor] onTreeContextMenu:', node.name, 'isFolder:', node.isFolder, 'hasPath:', !!node.path, 'hasDocId:', !!node.docId)
        if (node.isFolder) {
            this.openFolderContextMenu(event, node.path)
        } else if (node.path) {
            // Always use file context menu for files (even if they're open documents)
            // This ensures delete option is always available
            this.openFileContextMenu(event, node.path)
        } else if (node.docId) {
            // Fallback to doc context menu only if no path (unsaved temp files)
            this.openDocContextMenu(event, node.docId)
        }
    }

    private async moveDocumentToFolder (docId: string, folderPath: string|null): Promise<void> {
        const doc = this.documents.find(d => d.id === docId)
        if (!doc) {
            return
        }
        const currentFolder = this.resolveDocFolder(doc)
        const targetFolder = folderPath || null
        if (currentFolder === targetFolder) {
            return
        }
        const targetDir = targetFolder ?? this.folderRoot
        if (!fsSync.existsSync(targetDir)) {
            try {
                fsSync.mkdirSync(targetDir, { recursive: true })
            } catch {
                this.setError('Cannot create target folder')
                return
            }
        }
        const targetName = doc.name || path.basename(doc.path ?? doc.tempPath ?? 'untitled')
        const targetPath = await this.ensureUniquePath(targetDir, targetName)

        if (doc.path) {
            // If the document is outside managed folders and the target is "all documents", just drop the association.
            if (!currentFolder && !targetFolder) {
                doc.folderPath = null
                this.persistState()
                return
            }
            try {
                await fs.mkdir(path.dirname(targetPath), { recursive: true })
                await fs.rename(doc.path, targetPath)
                doc.path = targetPath
                doc.name = path.basename(targetPath)
                doc.folderPath = targetFolder
                this.setModelLanguage(doc)
            } catch (err: any) {
                this.setError(`Move failed: ${err?.message ?? err}`)
                return
            }
        } else {
            const oldTemp = doc.tempPath
            doc.folderPath = targetFolder
            doc.tempPath = this.allocateTempPath(doc.name || 'untitled', targetFolder)
            if (oldTemp && fsSync.existsSync(oldTemp)) {
                try {
                    await fs.mkdir(path.dirname(doc.tempPath), { recursive: true })
                    await fs.rename(oldTemp, doc.tempPath)
                } catch {
                    // best effort
                }
            }
        }
        this.persistState()
    }

    private async ensureUniquePath (dir: string, name: string): Promise<string> {
        const ext = path.extname(name)
        const base = path.basename(name, ext)
        let candidate = path.join(dir, name)
        let i = 1
        while (fsSync.existsSync(candidate)) {
            candidate = path.join(dir, `${base}-${i}${ext}`)
            i++
        }
        return candidate
    }

    constructor (
        private injector: Injector,
        private platform: PlatformService,
        private app: AppService,
        private tabsService: TabsService,
        @Optional() private ngbModal: NgbModal,
        private cdr: ChangeDetectorRef,
    ) {
        super(injector)
        this.setTitle('Code Editor')
    }

    get visibleDocuments (): EditorDocument[] {
        if (!this.selectedFolderPath) {
            return this.documents
        }
        return this.documents.filter(doc => this.resolveDocFolder(doc) === this.selectedFolderPath)
    }

    get treeItems (): Array<{ node: TreeNode, depth: number }> {
        return this._treeItems
    }

    private updateTreeItems (): void {
        const roots = this.buildTree()
        const flat: Array<{ node: TreeNode, depth: number }> = []
        const visit = (node: TreeNode, depth: number) => {
            flat.push({ node, depth })
            if (node.isFolder) {
                const key = node.path || ''
                if (this.expandedFolders.has(key)) {
                    for (const child of node.children) {
                        visit(child, depth + 1)
                    }
                }
            }
        }
        for (const root of roots) {
            visit(root, 0)
        }
        // Always assign new array reference to trigger change detection
        this._treeItems = [...flat]
    }

    private resolveTerminalService (): TerminalServiceType|null {
        const nodeRequire =
            (globalThis as any)?.nodeRequire
            ?? (globalThis as any)?.require
            ?? (globalThis as any)?.window?.nodeRequire
            ?? (globalThis as any)?.window?.require

        if (!nodeRequire) {
            return null
        }

        try {
            const localModule = nodeRequire('tlink-local')
            const token = localModule?.TerminalService
            if (!token) {
                return null
            }
            // TerminalService is providedIn: 'root' in tlink-local, so injector lookup is enough.
            return this.injector.get(token, null)
        } catch {
            return null
        }
    }

    private async resolveRunProfile (): Promise<any|null> {
        const preferredId = this.config?.store?.codeEditor?.runProfile
        try {
            const profilesService = this.injector.get(ProfilesService)
            const profiles = await profilesService.getProfiles({ includeBuiltin: true })
            if (preferredId) {
                // Prefer exact ID match; fallback to name match if someone put a name in the field
                return (
                    profiles.find(p => p.id === preferredId) ??
                    profiles.find(p => (p.name ?? '') === preferredId) ??
                    null
                )
            }

            // No explicit run profile configured: prefer fish when available (POSIXShellsProvider reads /etc/shells)
            const fishProfile = profiles.find(p => {
                if (p?.type !== 'local') {
                    return false
                }
                const cmd = p?.options?.command ?? ''
                const base = path.basename(cmd)
                return base === 'fish' || cmd === 'fish'
            }) ?? null

            return fishProfile
        } catch {
            return null
        }
    }

    async ngAfterViewInit (): Promise<void> {
        await this.initializeEditor()
        // Update tree items after initialization to avoid ExpressionChangedAfterItHasBeenCheckedError
        // Use setTimeout to defer to next tick, after change detection completes
        window.setTimeout(() => {
            this.updateTreeItems()
            this.cdr.markForCheck()
        }, 0)
    }

    ngOnDestroy (): void {
        this.persistState()
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer)
        }
        this.disposeEditors()
        this.disposeModels()
        if (this.externalOpenHandler) {
            window.removeEventListener('tlink-open-in-editor', this.externalOpenHandler)
        }
        super.ngOnDestroy()
    }

    async newFile (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const name = this.nextUntitledName()
        const doc = this.createDocument({
            name,
            path: null,
            tempPath: this.allocateTempPath(name, this.selectedFolderPath),
            folderPath: this.selectedFolderPath,
            content: '',
            languageId: 'plaintext',
            eol: 'LF',
            tabSize: 4,
            insertSpaces: true,
        })
        this.documents.push(doc)
        this.activateDoc(doc.id)
        this.persistState()
        this.updateTreeItems()
        window.setTimeout(() => this.cdr.markForCheck(), 0)
    }

    async openFile (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const uploads = await this.platform.startUpload({ multiple: false })
        if (!uploads.length) {
            return
        }
        const upload = uploads[0]
        try {
            const data = await upload.readAll()
            const content = new TextDecoder().decode(data)
            const filePath = (upload as any).filePath ?? null
            this.openDocumentFromContent(upload.getName(), filePath, content)
        } catch (err: any) {
            this.setError(`Failed to open file: ${err?.message ?? err}`)
        } finally {
            (upload as any).close?.()
        }
    }

    async openRecent (filePath: string): Promise<void> {
        if (!filePath) {
            return
        }
        try {
            const content = await fs.readFile(filePath, 'utf8')
            this.openDocumentFromContent(path.basename(filePath), filePath, content)
        } catch (err: any) {
            this.setError(`Failed to open ${filePath}: ${err?.message ?? err}`)
        }
    }

    async saveFile (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const doc = this.getActiveDoc()
        if (!doc) {
            return
        }
        await this.saveDocument(doc)
    }

    async saveFileAs (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const doc = this.getActiveDoc()
        if (!doc) {
            return
        }
        const content = doc.model.getValue()
        const data = new TextEncoder().encode(content)
        const download = await this.platform.startDownload(doc.name || 'untitled.txt', 0o644, data.length)
        if (!download) {
            return
        }
        try {
            await download.write(data)
            download.close()
            doc.isDirty = false
            doc.lastSavedValue = content
            const newPath = (download as any).filePath ?? null
            if (newPath) {
                doc.path = newPath
                doc.name = path.basename(newPath)
                this.rememberRecent(newPath)
            }
            this.updateTitle(doc)
            this.persistState()
        } catch (err: any) {
            this.setError(`Failed to save file: ${err?.message ?? err}`)
        }
    }

    async reopenClosed (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const snapshot = this.closedDocuments.pop()
        if (!snapshot) {
            return
        }
        const doc = this.createDocument(snapshot)
        doc.isDirty = !!snapshot.isDirty
        doc.lastSavedValue = snapshot.lastSavedValue ?? snapshot.content
        this.documents.push(doc)
        this.activateDoc(doc.id)
        if ((snapshot.content ?? '').includes('\u001b[')) {
            this.applyAnsiDecorations(doc, snapshot.content ?? '')
        }
    }

    async closeDocument (docId: string): Promise<void> {
        const doc = this.documents.find(d => d.id === docId)
        if (!doc) {
            return
        }
        if (!(await this.confirmDiscard(doc))) {
            return
        }
        this.closedDocuments.push(this.snapshotDocument(doc))
        doc.model?.dispose?.()
        if (!doc.path && doc.tempPath) {
            void this.deleteTemp(doc.tempPath)
        }
        this.documents = this.documents.filter(d => d.id !== docId)
        this.updateTreeItems()
        window.setTimeout(() => this.cdr.markForCheck(), 0)
        if (this.activeDocId === docId) {
            const next = this.documents[0]
            this.activeDocId = next?.id ?? null
            this.primaryEditor?.setModel(next?.model ?? null)
        }
        if (this.splitDocId === docId) {
            this.splitDocId = null
            this.splitEditor?.setModel(this.getActiveDoc()?.model ?? null)
        }
        this.persistState()
        this.updateStatus()
    }

    openDocContextMenu (event: MouseEvent, docId: string): void {
        event.preventDefault()
        event.stopPropagation()
        this.fileMenuOpen = false
        this.editMenuOpen = false

        this.docContextMenuOpen = true
        this.docContextMenuDocId = docId

        const menuWidth = 220
        const menuHeight = 120
        const padding = 8
        const maxX = Math.max(padding, (window.innerWidth || 0) - menuWidth - padding)
        const maxY = Math.max(padding, (window.innerHeight || 0) - menuHeight - padding)

        this.docContextMenuX = Math.max(padding, Math.min(event.clientX, maxX))
        this.docContextMenuY = Math.max(padding, Math.min(event.clientY, maxY))
    }

    async renameDocument (docId: string): Promise<void> {
        const doc = this.documents.find(d => d.id === docId)
        if (!doc) {
            return
        }

        const suggested = doc.name || (doc.path ? path.basename(doc.path) : 'untitled')
        const input = await this.promptForName('Rename document', suggested)
        const nextName = (input ?? '').trim()
        await this.renameDocumentWithName(docId, nextName)
    }

    private async promptForName (title: string, value: string): Promise<string|null> {
        if (this.ngbModal) {
            try {
                const modal = this.ngbModal.open(PromptModalComponent)
                modal.componentInstance.prompt = title
                modal.componentInstance.value = value
                const res = await modal.result.catch(() => null)
                return res?.value ?? null
            } catch {
                // fall back to window prompt
            }
        }
        if (typeof prompt === 'function') {
            return prompt(title, value)
        }
        return null
    }

    private async renameDocumentWithName (docId: string, nextNameRaw: string): Promise<void> {
        const doc = this.documents.find(d => d.id === docId)
        if (!doc) {
            return
        }
        const nextName = (nextNameRaw ?? '').trim()
        if (!nextName || nextName === doc.name) {
            return
        }
        if (/[\/\\]/.test(nextName)) {
            this.setError('Rename must be a file name (no path separators)')
            return
        }

        // Rename on disk when file exists, otherwise just rename the in-memory doc (+ temp file if present)
        if (doc.path) {
            const dir = path.dirname(doc.path)
            const oldPath = doc.path
            const newPath = path.join(dir, nextName)
            if (newPath === oldPath) {
                return
            }
            try {
                if (fsSync.existsSync(newPath)) {
                    this.setError('A file with that name already exists')
                    return
                }
                await fs.rename(oldPath, newPath)
                doc.path = newPath
                doc.name = path.basename(newPath)
                // update recent list (replace old path + ensure new is at top)
                this.recentFiles = this.recentFiles.map(p => p === oldPath ? newPath : p).filter(Boolean)
                this.rememberRecent(newPath)
                this.setModelLanguage(doc)
                this.updateTitle(doc)
                this.persistState()
            } catch (err: any) {
                this.setError(`Failed to rename: ${err?.message ?? err}`)
            }
            return
        }

        const oldTemp = doc.tempPath
        doc.name = nextName
        doc.tempPath = this.allocateTempPath(nextName, doc.folderPath ?? this.selectedFolderPath)
        // Best-effort: if temp file exists, rename it to match new extension/name
        if (oldTemp && doc.tempPath && fsSync.existsSync(oldTemp)) {
            try {
                await fs.mkdir(path.dirname(doc.tempPath), { recursive: true })
                await fs.rename(oldTemp, doc.tempPath)
            } catch {
                // ignore temp rename failures
            }
        }
        this.setModelLanguage(doc)
        this.updateTitle(doc)
        this.persistState()
    }

    startInlineRename (event: MouseEvent, docId: string): void {
        event.stopPropagation()
        const doc = this.documents.find(d => d.id === docId)
        if (!doc) {
            return
        }
        this.editingDocId = docId
        this.editingDocName = doc.name || (doc.path ? path.basename(doc.path) : 'untitled')
        setTimeout(() => {
            const input = document.getElementById(`code-editor-rename-${docId}`) as HTMLInputElement|null
            input?.focus()
            input?.select?.()
        })
    }

    cancelInlineRename (): void {
        this.editingDocId = null
        this.editingDocName = ''
    }

    async commitInlineRename (docId: string): Promise<void> {
        const name = this.editingDocName
        this.cancelInlineRename()
        await this.renameDocumentWithName(docId, name)
    }

    async renameDocumentFromContextMenu (): Promise<void> {
        const docId = this.docContextMenuDocId
        this.docContextMenuOpen = false
        this.docContextMenuDocId = null
        if (docId) {
            await this.renameDocument(docId)
        }
    }

    async closeDocumentFromContextMenu (): Promise<void> {
        const docId = this.docContextMenuDocId
        this.docContextMenuOpen = false
        this.docContextMenuDocId = null
        if (docId) {
            await this.closeDocument(docId)
        }
    }

    async moveDocumentFromContextMenu (folderPath: string|null): Promise<void> {
        const docId = this.docContextMenuDocId
        this.docContextMenuOpen = false
        this.docContextMenuDocId = null
        if (docId) {
            await this.moveDocumentToFolder(docId, folderPath)
        }
    }

    async canClose (): Promise<boolean> {
        const dirtyDocs = this.documents.filter(d => d.isDirty)
        for (const doc of dirtyDocs) {
            const proceed = await this.confirmDiscard(doc)
            if (!proceed) {
                return false
            }
        }
        return true
    }

    async getRecoveryToken (_options?: GetRecoveryTokenOptions): Promise<RecoveryToken> {
        return { type: 'app:code-editor' }
    }

    get statusLabel (): string {
        if (this.loadError) {
            return this.loadError
        }
        if (this.statusMessage) {
            return this.statusMessage
        }
        if (this.loading) {
            return 'Loading Monaco editor…'
        }
        return ''
    }

    async copySelection (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const editor = this.getActiveEditor()
        const model = this.getActiveDoc()?.model
        const selection = editor?.getSelection?.()
        if (!selection || !model) {
            return
        }
        const text = model.getValueInRange(selection)
        this.platform.setClipboard(text)
    }

    async pasteClipboard (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const editor = this.getActiveEditor()
        const model = this.getActiveDoc()?.model
        if (!editor || !model) {
            return
        }
        const text = this.platform.readClipboard()
        if (text == null) {
            return
        }
        const selection = editor.getSelection?.()
        const range = selection ?? model.getFullModelRange()
        editor.executeEdits('paste', [{
            range,
            text,
            forceMoveMarkers: true,
        }])
        editor.focus?.()
        const doc = this.getActiveDoc()
        if (doc) {
            doc.isDirty = true
            this.updateTitle(doc)
        }
    }

    toggleWordWrap (): void {
        if (!this.monaco) {
            return
        }
        this.wordWrapEnabled = !this.wordWrapEnabled
        this.primaryEditor?.updateOptions({ wordWrap: this.wordWrapEnabled ? 'on' : 'off' })
        this.splitEditor?.updateOptions({ wordWrap: this.wordWrapEnabled ? 'on' : 'off' })
        this.updateStatus()
    }

    toggleMinimap (): void {
        this.minimapEnabled = !this.minimapEnabled
        this.primaryEditor?.updateOptions({ minimap: { enabled: this.minimapEnabled } })
        this.splitEditor?.updateOptions({ minimap: { enabled: this.minimapEnabled } })
    }

    toggleTheme (event?: MouseEvent): void {
        event?.preventDefault()
        event?.stopPropagation()

        // Determine the actually focused pane in the split layout (terminal vs editor).
        // This is more reliable than tracking "lastFocusedPane" because terminal focus can come from clicks inside xterm.
        const focusedTab = this.parent instanceof SplitTabComponent ? this.parent.getFocusedTab() : null
        const terminalTab = this.isTerminalLikeTab(focusedTab) ? focusedTab as any : null

        if (terminalTab) {
            this.toggleTerminalThemeForTab(terminalTab)
            // Keep terminal focused (the Theme button lives in the editor pane, so we'd otherwise steal focus)
            terminalTab?.parent?.focus?.(terminalTab)
            terminalTab?.focus?.()
            return
        }

        const order = ['auto', 'light', 'dark', 'hc'] as const
        const idx = order.indexOf(this.themeMode)
        this.themeMode = order[(idx + 1) % order.length]
        this.applyTheme()
        this.persistState()
    }

    private cloneColorScheme (scheme: any): any {
        if (!scheme) {
            return scheme
        }
        return {
            ...scheme,
            colors: Array.isArray(scheme.colors) ? [...scheme.colors] : scheme.colors,
        }
    }

    private isSameColorScheme (a: any, b: any): boolean {
        if (!a && !b) {
            return true
        }
        if (!a || !b) {
            return false
        }
        const aColors = Array.isArray(a.colors) ? a.colors : []
        const bColors = Array.isArray(b.colors) ? b.colors : []
        if (aColors.length !== bColors.length) {
            return false
        }
        for (let i = 0; i < aColors.length; i++) {
            if (aColors[i] !== bColors[i]) {
                return false
            }
        }
        return a.foreground === b.foreground
            && a.background === b.background
            && a.cursor === b.cursor
            && (a.selection ?? null) === (b.selection ?? null)
            && (a.selectionForeground ?? null) === (b.selectionForeground ?? null)
            && (a.cursorAccent ?? null) === (b.cursorAccent ?? null)
    }

    private isTerminalLikeTab (tab: any): boolean {
        return !!(tab && typeof tab.configure === 'function' && tab.profile)
    }

    private toggleTerminalThemeForTab (term: any): void {
        if (!term?.profile) {
            return
        }
        const dark = this.config?.store?.terminal?.colorScheme
        const light = this.config?.store?.terminal?.lightColorScheme
        if (!dark || !light) {
            this.statusMessage = 'Terminal theme: unavailable'
            this.updateStatus()
            return
        }

        const current = term.profile.terminalColorScheme
        let next: any|undefined
        // Make the first click visible: switch to the opposite scheme from the current platform theme.
        const platformTheme = this.platform.getTheme()
        const primary = platformTheme === 'dark' ? light : dark
        const secondary = platformTheme === 'dark' ? dark : light

        if (!current) {
            next = this.cloneColorScheme(primary)
        } else if (this.isSameColorScheme(current, primary)) {
            next = this.cloneColorScheme(secondary)
        } else if (this.isSameColorScheme(current, secondary)) {
            next = undefined // follow app
        } else {
            next = this.cloneColorScheme(primary)
        }

        term.profile.terminalColorScheme = next
        try {
            term.configure()
        } catch {
            // ignore
        }
        this.statusMessage = `Terminal theme: ${next?.name ?? 'Follow app'}`
        this.updateStatus()
    }

    setFontSize (value: number): void {
        if (!value) {
            return
        }
        this.fontSize = Math.max(10, Math.min(28, value))
        this.primaryEditor?.updateOptions({ fontSize: this.fontSize, lineHeight: this.lineHeight })
        this.splitEditor?.updateOptions({ fontSize: this.fontSize, lineHeight: this.lineHeight })
    }

    setLineHeight (value: number): void {
        if (!value) {
            return
        }
        this.lineHeight = Math.max(14, Math.min(40, value))
        this.primaryEditor?.updateOptions({ lineHeight: this.lineHeight, fontSize: this.fontSize })
        this.splitEditor?.updateOptions({ lineHeight: this.lineHeight, fontSize: this.fontSize })
    }

    toggleAutosave (): void {
        this.autosaveEnabled = !this.autosaveEnabled
        this.startAutosave()
    }

    async goToLine (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const input = prompt('Go to line number')
        const line = input ? parseInt(input, 10) : NaN
        if (!line) {
            return
        }
        this.getActiveEditor()?.revealLine(line)
        this.getActiveEditor()?.setPosition({ lineNumber: line, column: 1 })
        this.getActiveEditor()?.focus()
    }

    async runFind (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        this.getActiveEditor()?.trigger('keyboard', 'actions.find', null)
    }

    async runReplace (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        this.getActiveEditor()?.getAction('editor.action.startFindReplaceAction')?.run()
    }

    async formatDocument (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        await this.getActiveEditor()?.getAction('editor.action.formatDocument')?.run()
    }

    async formatAsJSON (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const doc = this.getActiveDoc()
        if (!doc) {
            return
        }
        try {
            const parsed = JSON.parse(doc.model.getValue() || '{}')
            const pretty = JSON.stringify(parsed, null, 2)
            doc.model.setValue(pretty)
        } catch (err: any) {
            this.setError(`Invalid JSON: ${err?.message ?? err}`)
        }
    }

    toggleIndentationStyle (): void {
        const doc = this.getActiveDoc()
        if (!doc) {
            return
        }
        const next = !doc.insertSpaces
        doc.insertSpaces = next
        doc.model.updateOptions({ insertSpaces: next })
        this.statusIndent = `${doc.insertSpaces ? 'Spaces' : 'Tabs'}:${doc.tabSize}`
    }

    toggleEditMenu (event?: MouseEvent): void {
        event?.stopPropagation()
        this.editMenuOpen = !this.editMenuOpen
        if (this.editMenuOpen) {
            this.fileMenuOpen = false
        }
    }

    async handleEditAction (action: string): Promise<void> {
        switch (action) {
        case 'find':
            await this.runFind()
            break
        case 'replace':
            await this.runReplace()
            break
        case 'goto':
            await this.goToLine()
            break
        case 'format':
            await this.formatDocument()
            break
        case 'formatJson':
            await this.formatAsJSON()
            break
        case 'copy':
            await this.copySelection()
            break
        case 'paste':
            await this.pasteClipboard()
            break
        case 'send':
            await this.sendSelectionToTerminal()
            break
        case 'run':
            await this.runActiveFile()
            break
        case 'openClipboard':
            await this.openFromClipboard()
            break
        case 'wrap':
            this.toggleWordWrap()
            break
        case 'minimap':
            this.toggleMinimap()
            break
        case 'save':
            await this.saveFile()
            break
        case 'saveAs':
            await this.saveFileAs()
            break
        case 'new':
            await this.newFile()
            break
        case 'open':
            await this.openFile()
            break
        default:
            break
        }
        this.editMenuOpen = false
    }

    toggleFileMenu (event?: MouseEvent): void {
        event?.stopPropagation()
        this.fileMenuOpen = !this.fileMenuOpen
        if (this.fileMenuOpen) {
            this.editMenuOpen = false
        }
    }

    async handleFileAction (action: string): Promise<void> {
        switch (action) {
        case 'new':
            await this.newFile()
            break
        case 'open':
            await this.openFile()
            break
        case 'save':
            await this.saveFile()
            break
        case 'saveAs':
            await this.saveFileAs()
            break
        case 'reopen':
            await this.reopenClosed()
            break
        default:
            break
        }
        this.fileMenuOpen = false
    }

    toggleEOL (): void {
        const doc = this.getActiveDoc()
        if (!doc || !this.monaco) {
            return
        }
        const next = doc.model.getEOL() === '\r\n'
            ? this.monaco.editor.EndOfLineSequence.LF
            : this.monaco.editor.EndOfLineSequence.CRLF
        doc.model.setEOL(next)
        doc.eol = doc.model.getEOL() === '\r\n' ? 'CRLF' : 'LF'
        this.updateStatus()
    }

    setTabSize (value: number): void {
        const doc = this.getActiveDoc()
        if (!doc || !value) {
            return
        }
        const size = Math.max(1, Math.min(12, value))
        doc.tabSize = size
        doc.model.updateOptions({ tabSize: size })
        this.statusIndent = `${doc.insertSpaces ? 'Spaces' : 'Tabs'}:${doc.tabSize}`
    }

    async compareWithDisk (): Promise<void> {
        const doc = this.getActiveDoc()
        if (!doc?.path) {
            this.setError('File is not saved yet')
            return
        }
        try {
            const content = await fs.readFile(doc.path, 'utf8')
            this.enterDiff(doc, content, `${doc.name} (disk)`)
        } catch (err: any) {
            this.setError(`Compare failed: ${err?.message ?? err}`)
        }
    }

    async compareWithOtherDoc (docId: string): Promise<void> {
        const doc = this.getActiveDoc()
        const other = this.documents.find(d => d.id === docId)
        if (!doc || !other || docId === doc.id) {
            return
        }
        this.enterDiff(doc, other.model.getValue(), other.name)
    }

    selectDiffTarget (docId: string): void {
        this.pendingDiffDocId = docId || null
    }

    diffWithSelected (): void {
        if (this.pendingDiffDocId) {
            this.compareWithOtherDoc(this.pendingDiffDocId)
        }
    }

    exitDiffMode (): void {
        this.viewMode = 'editor'
        this.diffEditor?.dispose?.()
        this.diffEditor = null
        this.diffOriginalModel?.dispose?.()
        this.diffOriginalModel = null
        this.statusMessage = ''
        this.layoutEditors()
    }

    toggleSplitView (targetDoc?: EditorDocument): void {
        if (!this.splitHost) {
            return
        }
        this.viewMode = 'editor'
        this.statusMessage = ''
        if (this.splitEditor) {
            this.splitEditor.dispose()
            this.splitEditor = null
            this.splitDocId = null
            this.focusedEditor = 'primary'
            this.layoutEditors()
            this.persistState()
            return
        }
        if (!this.monaco) {
            return
        }
        this.splitEditor = this.monaco.editor.create(this.splitHost.nativeElement, this.editorOptions())
        this.registerEditorShortcuts(this.splitEditor)
        this.splitEditor.onDidFocusEditorText(() => {
            this.focusedEditor = 'split'
            this.updateStatus()
        })
        const docToShow = targetDoc ?? this.pickSplitDoc()
        this.splitDocId = docToShow?.id ?? null
        this.splitEditor.setModel(docToShow?.model ?? null)
        if (docToShow) {
            this.setModelLanguage(docToShow)
        }
        this.layoutEditors()
        this.persistState()
    }

    selectSplitDoc (docId: string): void {
        if (!docId) {
            this.splitDocId = null
            this.splitEditor?.setModel(this.getActiveDoc()?.model ?? null)
            return
        }
        this.splitDocId = docId
        const doc = this.documents.find(d => d.id === docId)
        if (doc) {
            this.splitEditor?.setModel(doc.model)
        }
        this.persistState()
    }

    activateDoc (docId: string): void {
        const doc = this.documents.find(d => d.id === docId)
        if (!doc) {
            return
        }
        this.viewMode = 'editor'
        this.statusMessage = ''
        if (this.splitEditor && this.focusedEditor === 'split') {
            this.splitDocId = docId
            this.splitEditor.setModel(doc.model)
            this.setModelLanguage(doc)
            this.updateStatus()
            this.persistState()
            return
        }
        this.activeDocId = docId
        this.primaryEditor?.setModel(doc.model)
        if (!this.splitDocId) {
            this.splitEditor?.setModel(doc.model)
        }
        this.setModelLanguage(doc)
        this.updateTitle(doc)
        this.updateStatus()
        this.persistState()
    }

    async sendSelectionToTerminal (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const model = this.getActiveDoc()?.model
        const editor = this.getActiveEditor()
        if (!model || !editor) {
            return
        }
        const selection = editor.getSelection()
        if (!selection) {
            return
        }
        const text = model.getValueInRange(selection)
        this.platform.setClipboard(text)
        window.dispatchEvent(new CustomEvent('tlink-send-to-terminal', { detail: { text } }))
    }

    async openFromClipboard (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const text = this.platform.readClipboard()
        if (!text) {
            return
        }
        const name = this.nextUntitledName()
        const doc = this.createDocument({
            name,
            path: null,
            tempPath: this.allocateTempPath(name, this.selectedFolderPath),
            folderPath: this.selectedFolderPath,
            content: text,
            languageId: 'plaintext',
            eol: 'LF',
            tabSize: 4,
            insertSpaces: true,
        })
        this.documents.push(doc)
        this.activateDoc(doc.id)
        if (text.includes('\u001b[')) {
            this.applyAnsiDecorations(doc, text)
        }
        this.persistState()
    }

    private async initializeEditor (): Promise<void> {
        try {
            this.loadFoldersFromState()
        // Don't call updateTreeItems here - it will be called in ngAfterViewInit
        // to avoid ExpressionChangedAfterItHasBeenCheckedError
            const monaco = await this.loadMonaco()
        if (!this.primaryHost) {
            throw new Error('Editor host unavailable')
        }

        if (!this.expandedFolders.size) {
            for (const f of this.folders) {
                this.expandedFolders.add(f.path)
            }
        }

            this.primaryEditor = monaco.editor.create(this.primaryHost.nativeElement, this.editorOptions())
            this.registerEditorShortcuts(this.primaryEditor)
            this.primaryEditor.onDidFocusEditorText(() => {
                this.focusedEditor = 'primary'
                this.updateStatus()
            })

            this.primaryEditor.onDidChangeCursorPosition(() => {
                this.updateStatus()
            })

            await this.restoreState()
            if (!this.documents.length) {
                await this.newFile()
            }
            if (this.pendingSplitDocId) {
                this.restoreSplitView()
            }
            this.loading = false
            this.applyTheme()
            this.layoutEditors()
            this.startAutosave()
            this.registerExternalHooks()
        } catch (err: any) {
            this.setError(`Failed to load editor: ${err?.message ?? err}`)
        }
    }

    private registerExternalHooks (): void {
        this.externalOpenHandler = (event: Event) => {
            const detail = (event as CustomEvent).detail ?? {}
            if (!detail?.content) {
                return
            }
            const doc = this.createDocument({
                name: detail.name ?? this.nextUntitledName(),
                path: null,
                content: detail.content,
                languageId: detail.languageId ?? 'plaintext',
                eol: 'LF',
                tabSize: 4,
                insertSpaces: true,
            })
            this.documents.push(doc)
            this.activateDoc(doc.id)
        }
        window.addEventListener('tlink-open-in-editor', this.externalOpenHandler)
    }

    private async ensureEditor (): Promise<boolean> {
        if (!this.primaryEditor) {
            await this.initializeEditor()
        }
        if (this.loadError) {
            this.setError(this.loadError ?? 'Editor not initialized')
            return false
        }
        return true
    }

    private editorOptions (): any {
        return {
            automaticLayout: true,
            minimap: { enabled: this.minimapEnabled },
            theme: this.currentThemeId(),
            wordWrap: this.wordWrapEnabled ? 'on' : 'off',
            fontSize: this.fontSize,
            lineHeight: this.lineHeight,
            // Enable code completion features
            quickSuggestions: {
                other: true,
                comments: true,
                strings: true,
            },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            tabCompletion: 'on',
            wordBasedSuggestions: 'matchingDocuments',
            parameterHints: {
                enabled: true,
            },
            hover: {
                enabled: true,
            },
        }
    }

    private createDocument (snapshot: EditorDocumentSnapshot): EditorDocument {
        if (!this.monaco) {
            throw new Error('Monaco not ready')
        }
        const model = this.monaco.editor.createModel(snapshot.content, snapshot.languageId || 'plaintext')
        model.setEOL(snapshot.eol === 'CRLF' ? this.monaco.editor.EndOfLineSequence.CRLF : this.monaco.editor.EndOfLineSequence.LF)
        model.updateOptions({ tabSize: snapshot.tabSize, insertSpaces: snapshot.insertSpaces })
        const folderPath = snapshot.folderPath ?? (snapshot.path ? path.dirname(snapshot.path) : null)
        const doc: EditorDocument = {
            ...snapshot,
            folderPath,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            model,
            isDirty: snapshot.isDirty ?? false,
            lastSavedValue: snapshot.lastSavedValue ?? snapshot.content,
            ansiDecorationIds: [],
        }
        model.onDidChangeContent(() => {
            doc.isDirty = doc.model.getValue() !== doc.lastSavedValue
            if (doc.languageId === 'plaintext') {
                const detected = this.detectLanguageFromContent(doc.model.getValue())
                if (detected && detected !== 'plaintext') {
                    this.monaco.editor.setModelLanguage(doc.model, detected)
                    doc.languageId = detected
                }
            }
            this.updateTitle(doc)
            this.updateStatus()
            this.persistState()
            this.queueSaveTemp(doc)
        })
        model.onDidChangeOptions(() => {
            const opts = model.getOptions()
            doc.tabSize = opts.tabSize
            doc.insertSpaces = opts.insertSpaces
            this.updateStatus()
            this.persistState()
        })
        // Auto-detect language when no extension (untitled)
        if (!snapshot.languageId || snapshot.languageId === 'plaintext') {
            const detected = this.pickLanguage(snapshot.name, snapshot.content)
            if (detected && detected !== 'plaintext') {
                this.monaco.editor.setModelLanguage(model, detected)
                doc.languageId = detected
            }
        }
        return doc
    }

    private openDocumentFromContent (name: string, filePath: string|null, content: string): void {
        const existing = this.documents.find(d => d.path && filePath && d.path === filePath)
        if (existing) {
            existing.model.setValue(content)
            existing.lastSavedValue = content
            existing.isDirty = false
            this.activateDoc(existing.id)
            return
        }
        const doc = this.createDocument({
            name,
            path: filePath,
            tempPath: filePath ? null : this.allocateTempPath(name, this.selectedFolderPath),
            folderPath: this.getFolderForPath(filePath) ?? this.selectedFolderPath,
            content,
            languageId: this.pickLanguage(name, content),
            eol: content.includes('\r\n') ? 'CRLF' : 'LF',
            tabSize: 4,
            insertSpaces: true,
        })
        doc.lastSavedValue = content
        this.documents.push(doc)
        this.activateDoc(doc.id)
        if (content.includes('\u001b[')) {
            this.applyAnsiDecorations(doc, content)
        }
        if (filePath) {
            this.rememberRecent(filePath)
        }
        this.persistState()
    }

    private pickLanguage (fileName: string, content?: string): string {
        const ext = (fileName.split('.').pop() || '').toLowerCase()
        const lang = this.monaco?.languages.getLanguages().find(l => l.extensions?.includes('.' + ext))
        if (lang?.id) {
            return lang.id
        }
        return this.detectLanguageFromContent(content ?? '') || 'plaintext'
    }

    private detectLanguageFromContent (content: string): string {
        const trimmed = content.trimStart()
        const firstLine = trimmed.split('\n')[0] || ''

        if (firstLine.startsWith('#!')) {
            if (firstLine.includes('python')) return 'python'
            if (firstLine.includes('bash') || firstLine.includes('sh')) return 'shell'
            if (firstLine.includes('node')) return 'javascript'
        }

        // JSON detection
        if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
            try {
                JSON.parse(trimmed)
                return 'json'
            } catch (_) {
                // ignore
            }
        }

        // YAML detection
        if (/^---\s/.test(trimmed) || /^[\w-]+:\s/.test(trimmed)) {
            return 'yaml'
        }

        // Python cues
        if (/^\s*import\s+\w+/m.test(content) || /def\s+\w+\(/.test(content)) {
            return 'python'
        }

        // Shell cues
        if (/^\s*(sudo|echo|cd|ls|export)\b/m.test(content) && content.includes('\n')) {
            return 'shell'
        }

        // JS/TS cues
        if (/^\s*(import|export)\s+/.test(content) || /function\s+\w+\(/.test(content)) {
            return 'javascript'
        }

        // HTML
        if (/<(html|body|div|span|head|script|style)[\s>]/i.test(content)) {
            return 'html'
        }

        // CSS
        if (/\.\w+\s*\{[^}]*\}/.test(content)) {
            return 'css'
        }

        return 'plaintext'
    }

    private async saveDocument (doc: EditorDocument): Promise<boolean> {
        const content = doc.model.getValue()
        const data = new TextEncoder().encode(content)

        if (doc.path) {
            try {
                await fs.mkdir(path.dirname(doc.path), { recursive: true })
                await fs.writeFile(doc.path, data)
                doc.isDirty = false
                doc.lastSavedValue = content
                this.updateTitle(doc)
                this.rememberRecent(doc.path)
                if (doc.tempPath) {
                    await this.deleteTemp(doc.tempPath)
                    doc.tempPath = null
                }
                this.persistState()
                return true
            } catch (err: any) {
                this.setError(`Failed to save file: ${err?.message ?? err}`)
                return false
            }
        }

        const download = await this.platform.startDownload(doc.name || 'untitled.txt', 0o644, data.length)
        if (!download) {
            return false
        }

        try {
            await download.write(data)
            download.close()
            doc.isDirty = false
            doc.lastSavedValue = content
            const newPath = (download as any).filePath ?? null
            if (newPath) {
                doc.path = newPath
                doc.name = path.basename(newPath)
                this.rememberRecent(newPath)
            }
            if (doc.tempPath) {
                await this.deleteTemp(doc.tempPath)
                doc.tempPath = null
            }
            this.updateTitle(doc)
            this.persistState()
            return true
        } catch (err: any) {
            this.setError(`Failed to save file: ${err?.message ?? err}`)
            return false
        }
    }

    private snapshotDocument (doc: EditorDocument): EditorDocumentSnapshot {
        return {
            name: doc.name,
            path: doc.path,
            tempPath: doc.tempPath ?? null,
            folderPath: this.resolveDocFolder(doc),
            content: doc.model.getValue(),
            languageId: this.monaco?.editor.getModelLanguageId?.(doc.model) ?? 'plaintext',
            eol: doc.model.getEOL() === '\r\n' ? 'CRLF' : 'LF',
            tabSize: doc.tabSize,
            insertSpaces: doc.insertSpaces,
            isDirty: doc.isDirty,
            lastSavedValue: doc.lastSavedValue,
        }
    }

    private async confirmDiscard (doc: EditorDocument): Promise<boolean> {
        if (!doc.isDirty) {
            return true
        }
        return confirm(`Close ${doc.name} without saving?`)
    }

    private updateStatus (): void {
        const doc = this.getActiveDoc()
        if (!this.primaryEditor || !this.monaco || !doc) {
            this.statusLineCol = ''
            this.statusLanguage = ''
            this.statusEOL = ''
            this.statusIndent = ''
            this.statusWrap = ''
            this.breadcrumbs = []
            return
        }
        const pos = this.primaryEditor.getPosition()
        this.statusLineCol = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : ''
        const lang = this.monaco.editor.getModelLanguageId?.(doc.model) ?? ''
        this.statusLanguage = lang || ''
        this.statusEOL = doc.model.getEOL() === '\r\n' ? 'CRLF' : 'LF'
        this.statusIndent = `${doc.insertSpaces ? 'Spaces' : 'Tabs'}:${doc.tabSize}`
        this.statusWrap = this.wordWrapEnabled ? 'Wrap:on' : 'Wrap:off'
        this.breadcrumbs = this.buildBreadcrumbs(doc, pos?.lineNumber ?? 0, pos?.column ?? 0)
    }

    private buildBreadcrumbs (doc: EditorDocument, line: number, column: number): string[] {
        const parts = doc.path ? doc.path.split(path.sep).filter(Boolean) : [doc.name]
        if (line) {
            const word = doc.model.getWordAtPosition({ lineNumber: line, column })?.word
            if (word) {
                parts.push(word)
            }
        }
        return parts
    }

    beginSidebarResize (event: MouseEvent): void {
        event.preventDefault()
        this.resizingSidebar = true
        this.resizeStartX = event.clientX
        this.resizeStartWidth = this.sidebarWidth
    }

    private resolveMonacoBase (): string {
        const candidates: string[] = []

        if (typeof process !== 'undefined' && (process as any).cwd) {
            const cwd = (process as any).cwd()
            candidates.push(path.join(cwd, 'app/dist/assets/monaco'))
            candidates.push(path.join(cwd, 'dist/assets/monaco'))
        }

        const resourcesPath = (process as any)?.resourcesPath
        if (resourcesPath) {
            candidates.push(path.join(resourcesPath, 'assets/monaco'))
            candidates.push(path.join(resourcesPath, 'app.asar.unpacked/assets/monaco'))
        }

        candidates.push(path.join(path.dirname((document.currentScript as any)?.src ?? ''), 'assets/monaco'))

        const found = candidates.find(p => p && fsSync.existsSync(p))
        return found ? found.replace(/\\/g, '/') : 'assets/monaco'
    }

    private loadMonaco (): Promise<Monaco> {
        if (this.monaco) {
            return Promise.resolve(this.monaco)
        }
        if (this.monacoPromise) {
            return this.monacoPromise
        }

        this.monacoPromise = new Promise((resolve, reject) => {
            const finish = () => {
                const globalMonaco = (window as any).monaco as Monaco
                if (!globalMonaco) {
                    reject(new Error('Monaco not available'))
                    return
                }
                this.monaco = globalMonaco
                this.configureLanguageDefaults()
                resolve(globalMonaco)
            }

            const configureLoader = (amdRequire: any): boolean => {
                if (!amdRequire?.config) {
                    return false
                }
                (window as any).MonacoEnvironment = {
                    baseUrl: `${this.monacoBase}/vs`,
                    getWorkerUrl: () => `${this.monacoBase}/vs/base/worker/workerMain.js`,
                }
                amdRequire.config({
                    paths: {
                        vs: `${this.monacoBase}/vs`,
                    },
                })
                amdRequire(['vs/editor/editor.main'], () => finish(), reject)
                return true
            }

            const existingRequire = (window as any).require
            const existingMonacoAmd = this.monacoAmdRequire ?? (window as any).monacoAmdRequire
            if (existingMonacoAmd?.config) {
                try {
                    if (configureLoader(existingMonacoAmd)) {
                        return
                    }
                } catch (err) {
                    reject(err)
                    return
                }
            }

            if (existingRequire?.config && existingRequire?.toUrl) {
                try {
                    this.monacoAmdRequire = existingRequire
                    ;(window as any).monacoAmdRequire = existingRequire
                    if (configureLoader(existingRequire)) {
                        return
                    }
                } catch (err) {
                    reject(err)
                    return
                }
            }

            const previousRequire = (window as any).require
            const previousModule = (window as any).module
            ;(window as any).require = undefined
            ;(window as any).module = undefined

            const restoreGlobals = () => {
                if (previousRequire) {
                    (window as any).require = previousRequire
                } else {
                    delete (window as any).require
                }
                if (previousModule) {
                    (window as any).module = previousModule
                } else {
                    delete (window as any).module
                }
            }

        const script = document.createElement('script')
        script.src = `${this.monacoBase}/vs/loader.js`
        script.async = true
        script.onload = () => {
            try {
                    const amdRequire = (window as any).require
                    this.monacoAmdRequire = amdRequire
                    ;(window as any).monacoAmdRequire = amdRequire
                    if (!configureLoader(amdRequire)) {
                        reject(new Error('AMD loader is not ready'))
                        return
                    }
                } catch (err) {
                    reject(err)
                } finally {
                    restoreGlobals()
                }
            }
            script.onerror = () => {
                restoreGlobals()
                reject(new Error('Failed to load Monaco loader script'))
            }
            document.body.appendChild(script)
        })

        return this.monacoPromise
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown (event: KeyboardEvent): void {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            // optional: do nothing special; placeholder to keep tree navigation extensible
        }
    }

    private configureLanguageDefaults (): void {
        if (!this.monaco) {
            return
        }
        this.monaco.languages.typescript?.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
        })
        this.monaco.languages.typescript?.typescriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false,
            noSyntaxValidation: false,
        })
    }

    private applyTheme (): void {
        if (!this.monaco) {
            return
        }
        this.monaco.editor.setTheme(this.currentThemeId())
    }

    private async ensureDocumentOnDisk (doc: EditorDocument): Promise<string|null> {
        if (doc.path) {
            const ok = await this.saveDocument(doc)
            return ok ? doc.path : null
        }
        const target = doc.tempPath ?? this.allocateTempPath(doc.name || 'untitled', doc.folderPath ?? this.selectedFolderPath)
        doc.tempPath = target
        try {
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.writeFile(target, doc.model.getValue(), 'utf8')
            return target
        } catch {
            return null
        }
    }

    private getActiveSelectionText (): string|null {
        const editor = this.getActiveEditor()
        const model = this.getActiveDoc()?.model
        if (!editor || !model) {
            return null
        }
        const selection = editor.getSelection?.()
        if (!selection) {
            return null
        }
        // Monaco selection is empty when start==end
        if (
            selection.startLineNumber === selection.endLineNumber &&
            selection.startColumn === selection.endColumn
        ) {
            return null
        }
        const text = model.getValueInRange(selection)
        return text?.trim?.() ? text : null
    }

    private allocateTempPathForSnippet (baseName: string): string {
        // Keep extension so buildRunCommand can pick the right runner (python/node/bash/etc.)
        const ext = path.extname(baseName || '') || '.txt'
        const safeBase = (path.basename(baseName || 'snippet') || 'snippet').replace(/[\\/]/g, '_')
        const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeBase}`
        return path.join(this.getTempDir(), `${unique}${ext}`)
    }

    private async ensureSnippetOnDisk (doc: EditorDocument, snippet: string): Promise<string|null> {
        const filePath = this.allocateTempPathForSnippet(doc.name || 'snippet.txt')
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            await fs.writeFile(filePath, snippet, 'utf8')
            return filePath
        } catch {
            return null
        }
    }

    private buildRunCommand (doc: EditorDocument, filePath: string, args: string): string {
        const ext = (path.extname(doc.name || '') || '').toLowerCase()
        switch (ext) {
        case '.py':
            return `python3 "${filePath}"${args ? ` ${args}` : ''}`
        case '.js':
        case '.mjs':
        case '.cjs':
            return `node "${filePath}"${args ? ` ${args}` : ''}`
        case '.ts':
            return `ts-node "${filePath}"`
                + (args ? ` ${args}` : '')
        case '.sh':
            return `bash "${filePath}"${args ? ` ${args}` : ''}`
        default:
            return `bash "${filePath}"${args ? ` ${args}` : ''}`
        }
    }

    async runActiveFile (): Promise<void> {
        if (!(await this.ensureEditor())) {
            return
        }
        const doc = this.getActiveDoc()
        if (!doc) {
            return
        }
        const selection = this.getActiveSelectionText()
        const filePath = selection
            ? await this.ensureSnippetOnDisk(doc, selection)
            : await this.ensureDocumentOnDisk(doc)
        if (!filePath) {
            this.setError('Save the file before running.')
            return
        }
        const argString = (this.runArgs ?? '').trim()
        const cmd = this.buildRunCommand(doc, filePath, argString)
        const terminal = await this.ensureRunTerminal(path.dirname(filePath))
        if (!terminal) {
            this.setError('Unable to open run terminal')
            return
        }
        this.sendToTerminal(terminal, `${cmd}\n`)
        this.statusMessage = `Running in terminal: ${cmd}`
        this.updateStatus()
    }

    async closeRunTerminal (): Promise<void> {
        const tab = this.runTerminalTab as (BaseTabComponent|null)
        if (!tab) {
            return
        }
        // Clear reference early to avoid re-entrancy
        this.runTerminalTab = null
        try {
            tab.destroy()
        } catch (err) {
            console.warn('Failed to close run terminal tab', err)
        }
    }

    private pickSplitDoc (): EditorDocument|null {
        if (this.pendingSplitDocId) {
            const match = this.documents.find(d => d.id === this.pendingSplitDocId)
            this.pendingSplitDocId = null
            if (match) {
                return match
            }
        }
        const activeDoc = this.getActiveDoc()
        const otherDoc = this.documents.find(d => d.id !== activeDoc?.id)
        if (otherDoc) {
            return otherDoc
        }
        if (activeDoc) {
            const name = `${activeDoc.name} copy`
            const doc = this.createDocument({
                name,
                path: null,
                tempPath: this.allocateTempPath(name, this.selectedFolderPath),
                folderPath: this.selectedFolderPath,
                content: activeDoc.model.getValue(),
                languageId: activeDoc.languageId,
                eol: activeDoc.eol,
                tabSize: activeDoc.tabSize,
                insertSpaces: activeDoc.insertSpaces,
            })
            doc.isDirty = true
            this.documents.push(doc)
            return doc
        }
        const name = this.nextUntitledName()
        const doc = this.createDocument({
            name,
            path: null,
            tempPath: this.allocateTempPath(name, this.selectedFolderPath),
            folderPath: this.selectedFolderPath,
            content: '',
            languageId: 'plaintext',
            eol: 'LF',
            tabSize: 4,
            insertSpaces: true,
        })
        this.documents.push(doc)
        return doc
    }

    private currentThemeId (): string {
        if (this.themeMode === 'light') {
            return 'vs'
        }
        if (this.themeMode === 'dark') {
            return 'vs-dark'
        }
        if (this.themeMode === 'hc') {
            return 'hc-black'
        }
        return this.platform.getTheme() === 'dark' ? 'vs-dark' : 'vs'
    }

    private restoreSplitView (): void {
        if (!this.pendingSplitDocId) {
            return
        }
        if (!this.splitHost || !this.monaco) {
            this.pendingSplitDocId = null
            return
        }
        if (this.splitEditor) {
            return
        }
        this.viewMode = 'editor'
        this.statusMessage = ''
        this.splitEditor = this.monaco.editor.create(this.splitHost.nativeElement, this.editorOptions())
        this.registerEditorShortcuts(this.splitEditor)
        this.splitEditor.onDidFocusEditorText(() => {
            this.focusedEditor = 'split'
            this.updateStatus()
        })
        const targetDoc = this.pickSplitDoc()
        this.splitDocId = targetDoc?.id ?? null
        this.splitEditor.setModel(targetDoc?.model ?? null)
        if (targetDoc) {
            this.setModelLanguage(targetDoc)
        }
        this.layoutEditors()
        this.persistState()
    }

    private setModelLanguage (doc: EditorDocument): void {
        if (!this.monaco || !doc?.model) {
            return
        }
        const lang = this.pickLanguage(doc.name, doc.model.getValue())
        this.monaco.editor.setModelLanguage(doc.model, lang)
        doc.languageId = lang
    }

    private registerEditorShortcuts (editor: any): void {
        if (!this.monaco || !editor) {
            return
        }
        const { KeyMod, KeyCode } = this.monaco
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyC, () => this.copySelection())
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyV, () => this.pasteClipboard())
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => this.saveFile())
        editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS, () => this.saveFileAs())
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyO, () => this.openFile())
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyN, () => this.newFile())
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyF, () => this.runFind())
        editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF, () => this.runReplace())
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyG, () => this.goToLine())
        editor.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => this.runActiveFile())
    }

    private nextUntitledName (): string {
        const count = this.documents.filter(d => d.path === null).length + 1
        return `Untitled-${count}`
    }

    private layoutEditors (): void {
        this.primaryEditor?.layout()
        this.splitEditor?.layout()
        this.diffEditor?.layout?.()
    }

    private startAutosave (): void {
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer)
        }
        if (!this.autosaveEnabled) {
            return
        }
        this.autosaveTimer = window.setInterval(() => this.autosaveTick(), this.autosaveIntervalMs)
    }

    private async autosaveTick (): Promise<void> {
        for (const doc of this.documents) {
            if (doc.isDirty && doc.path) {
                await this.saveDocument(doc)
            }
        }
    }

    private persistState (): void {
        this.persistFolders()
        const docState = this.documents.map(doc => this.snapshotDocument(doc))
        const active = this.activeDocId
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('codeEditor.recent', JSON.stringify(this.recentFiles.slice(0, 10)))
            localStorage.setItem('codeEditor.docs', JSON.stringify(docState))
            localStorage.setItem('codeEditor.active', active ?? '')
            localStorage.setItem('codeEditor.themeMode', this.themeMode)
            localStorage.setItem('codeEditor.split', this.splitEditor ? '1' : '')
            localStorage.setItem('codeEditor.splitDoc', this.splitDocId ?? '')
            localStorage.setItem('codeEditor.runArgs', this.runArgs ?? '')
            localStorage.setItem('codeEditor.sidebarWidth', String(this.sidebarWidth))
        }
        // best-effort temp save for untitled docs
        for (const doc of this.documents) {
            if (!doc.path && doc.tempPath) {
                this.queueSaveTemp(doc)
            }
        }
        this.recoveryStateChangedHint.next()
    }

    private allocateTempPath (name: string, folderPath?: string|null): string {
        const base = folderPath ?? this.getTempDir()
        const safeName = name.replace(/[\\/]/g, '_')
        const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`
        return path.join(base, unique)
    }

    private getTempDir (): string {
        const home = process.env.TLINK_CONFIG_DIR || process.env.HOME || os.tmpdir()
        const dir = path.join(home, '.tlink', 'code-editor-temp')
        if (!fsSync.existsSync(dir)) {
            try {
                fsSync.mkdirSync(dir, { recursive: true })
            } catch {
                return os.tmpdir()
            }
        }
        return dir
    }

    private queueSaveTemp (doc: EditorDocument): void {
        if (!doc.tempPath) {
            return
        }
        const existing = this.tempSaveTimers.get(doc.id)
        if (existing) {
            clearTimeout(existing)
        }
        const timer = window.setTimeout(() => {
            this.saveTemp(doc).catch(() => null)
            this.tempSaveTimers.delete(doc.id)
        }, 500)
        this.tempSaveTimers.set(doc.id, timer)
    }

    private async saveTemp (doc: EditorDocument): Promise<void> {
        if (!doc.tempPath) {
            return
        }
        try {
            await fs.mkdir(path.dirname(doc.tempPath), { recursive: true })
            await fs.writeFile(doc.tempPath, doc.model.getValue(), 'utf8')
        } catch {
            // best-effort temp save
        }
    }

    private async deleteTemp (tempPath: string): Promise<void> {
        try {
            await fs.unlink(tempPath)
        } catch {
            // ignore
        }
    }

    private async restoreState (): Promise<void> {
        this.recentFiles = this.loadRecent()
        if (typeof localStorage === 'undefined') {
            return
        }
        const savedTheme = localStorage.getItem('codeEditor.themeMode') as ('auto'|'light'|'dark'|'hc'|null)
        if (savedTheme && ['auto', 'light', 'dark', 'hc'].includes(savedTheme)) {
            this.themeMode = savedTheme
        }
        const savedRunArgs = localStorage.getItem('codeEditor.runArgs')
        if (savedRunArgs !== null) {
            this.runArgs = savedRunArgs
        }
        const savedSidebar = localStorage.getItem('codeEditor.sidebarWidth')
        if (savedSidebar) {
            const parsed = parseInt(savedSidebar, 10)
            if (!isNaN(parsed) && parsed >= 160 && parsed <= 480) {
                this.sidebarWidth = parsed
            }
        }
        const splitEnabled = localStorage.getItem('codeEditor.split') === '1'
        const savedSplitDoc = localStorage.getItem('codeEditor.splitDoc') || null
        const raw = localStorage.getItem('codeEditor.docs')
        if (!raw) {
            return
        }
        try {
            const docs: EditorDocumentSnapshot[] = JSON.parse(raw)
            for (const snap of docs) {
                let snapContent = snap.content
                if (!snap.path && snap.tempPath && fsSync.existsSync(snap.tempPath)) {
                    try {
                        snapContent = fsSync.readFileSync(snap.tempPath, 'utf8')
                    } catch {
                        // ignore temp read errors
                    }
                }
                const doc = this.createDocument({ ...snap, content: snapContent })
                doc.lastSavedValue = snap.lastSavedValue ?? snapContent
                this.documents.push(doc)
            }
            const activeId = localStorage.getItem('codeEditor.active')
            if (activeId) {
                this.activateDoc(activeId)
            } else if (this.documents.length) {
                this.activateDoc(this.documents[0].id)
            }
            if (splitEnabled) {
                this.pendingSplitDocId = savedSplitDoc || this.activeDocId || (this.documents[0]?.id ?? null)
            }
        } catch {
            // ignore corrupted state
        }
    }

    private loadRecent (): string[] {
        if (typeof localStorage === 'undefined') {
            return []
        }
        try {
            return JSON.parse(localStorage.getItem('codeEditor.recent') ?? '[]') ?? []
        } catch {
            return []
        }
    }

    private rememberRecent (filePath: string): void {
        this.recentFiles = [filePath, ...this.recentFiles.filter(f => f !== filePath)].slice(0, 10)
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('codeEditor.recent', JSON.stringify(this.recentFiles))
        }
    }

    private getActiveEditor (): any {
        if (this.viewMode === 'diff') {
            return this.diffEditor
        }
        if (this.splitEditor?.hasTextFocus?.()) {
            return this.splitEditor
        }
        if (this.primaryEditor?.hasTextFocus?.()) {
            return this.primaryEditor
        }
        if (this.focusedEditor === 'split' && this.splitEditor) {
            return this.splitEditor
        }
        return this.primaryEditor
    }

    private getActiveDoc (): EditorDocument|null {
        if (this.viewMode === 'editor') {
            if (this.splitEditor?.hasTextFocus?.() && this.splitDocId) {
                return this.documents.find(d => d.id === this.splitDocId) ?? null
            }
            if (this.primaryEditor?.hasTextFocus?.() && this.activeDocId) {
                return this.documents.find(d => d.id === this.activeDocId) ?? null
            }
            if (this.focusedEditor === 'split' && this.splitDocId) {
                return this.documents.find(d => d.id === this.splitDocId) ?? null
            }
        }
        if (!this.activeDocId) {
            return null
        }
        return this.documents.find(d => d.id === this.activeDocId) ?? null
    }

    private disposeEditors (): void {
        this.primaryEditor?.dispose?.()
        this.splitEditor?.dispose?.()
        this.diffEditor?.dispose?.()
    }

    private disposeModels (): void {
        this.documents.forEach(doc => doc.model?.dispose?.())
        this.documents = []
    }

    private updateTitle (doc: EditorDocument): void {
        const suffix = doc.isDirty ? ' •' : ''
        this.setTitle(`${doc.name}${suffix}`)
    }

    private enterDiff (doc: EditorDocument, originalContent: string, label: string): void {
        if (!this.monaco || !this.diffHost) {
            return
        }
        this.viewMode = 'diff'
        this.diffEditor?.dispose?.()
        this.diffOriginalModel?.dispose?.()
        this.diffOriginalModel = this.monaco.editor.createModel(originalContent, this.pickLanguage(doc.name))
        this.diffEditor = this.monaco.editor.createDiffEditor(this.diffHost.nativeElement, {
            ...this.editorOptions(),
            renderSideBySide: true,
        })
        this.diffEditor.setModel({
            original: this.diffOriginalModel,
            modified: doc.model,
        })
        this.diffEditor.updateOptions({ readOnly: false })
        this.diffEditor.modifiedEditor?.updateOptions?.({ readOnly: false })
        this.diffEditor.originalEditor?.updateOptions?.({ readOnly: true })
        this.statusMessage = `Comparing against ${label}`
        this.layoutEditors()
    }

    private setError (message: string): void {
        this.loadError = message
        this.loading = false
    }

    @HostListener('document:click', ['$event'])
    closeEditMenu (event?: MouseEvent): void {
        const target = (event?.target ?? null) as any
        // Don't close menus when clicking inside them.
        // Note: this also protects against capture-phase document listeners closing the menu
        // before the menu item's click handler runs.
        if (target?.closest?.('.doc-context-menu') || target?.closest?.('.menu-container')) {
            return
        }
        // Close all context menus
        this.editMenuOpen = false
        this.fileMenuOpen = false
        this.docContextMenuOpen = false
        this.folderContextMenuOpen = false
        this.fileContextMenuOpen = false
        // Clear menu state
        this.docContextMenuDocId = null
        this.folderContextMenuPath = null
        this.fileContextMenuPath = null
    }

    @HostListener('document:contextmenu', ['$event'])
    closeContextMenusOnRightClick (event?: MouseEvent): void {
        const target = (event?.target ?? null) as any
        // Don't close if right-clicking on a menu or menu trigger
        if (target?.closest?.('.doc-context-menu') || target?.closest?.('.menu-container') || target?.closest?.('.tree-row')) {
            return
        }
        // Close all context menus when right-clicking elsewhere
        this.docContextMenuOpen = false
        this.folderContextMenuOpen = false
        this.fileContextMenuOpen = false
        this.docContextMenuDocId = null
        this.folderContextMenuPath = null
        this.fileContextMenuPath = null
    }

    @HostListener('document:mousemove', ['$event'])
    onSidebarDrag (event: MouseEvent): void {
        if (!this.resizingSidebar) {
            return
        }
        const delta = event.clientX - this.resizeStartX
        const next = Math.min(480, Math.max(160, this.resizeStartWidth + delta))
        if (next !== this.sidebarWidth) {
            this.sidebarWidth = next
            this.layoutEditors()
        }
    }

    @HostListener('document:mouseup')
    endSidebarDrag (): void {
        if (!this.resizingSidebar) {
            return
        }
        this.resizingSidebar = false
        this.persistState()
    }

    private parseAnsi (input: string): { text: string, segments: Array<{ start: number, end: number, classes: string }> } {
        const ESC = '\u001b['
        let i = 0
        let clean = ''
        const segments: Array<{ start: number, end: number, classes: string }> = []
        let activeStart = 0
        let fg: string|null = null
        let bg: string|null = null
        let bold = false
        let underline = false

        const pushSegment = (end: number) => {
            if (end > activeStart && (fg || bg || bold || underline)) {
                const classes = [
                    fg ? `ansi-fg-${fg}` : '',
                    bg ? `ansi-bg-${bg}` : '',
                    bold ? 'ansi-bold' : '',
                    underline ? 'ansi-underline' : '',
                ].filter(Boolean).join(' ')
                segments.push({ start: activeStart, end, classes })
            }
            activeStart = end
        }

        const setSgr = (codes: number[]) => {
            for (const code of codes) {
                if (code === 0) {
                    pushSegment(clean.length)
                    fg = bg = null
                    bold = underline = false
                    continue
                }
                if (code === 1) bold = true
                if (code === 4) underline = true
                if (code === 22) bold = false
                if (code === 24) underline = false
                if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
                    const map: Record<number, string> = {
                        30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
                        90: 'brblack', 91: 'brred', 92: 'brgreen', 93: 'bryellow', 94: 'brblue', 95: 'brmagenta', 96: 'brcyan', 97: 'brwhite',
                    }
                    pushSegment(clean.length)
                    fg = map[code] ?? fg
                }
                if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
                    const map: Record<number, string> = {
                        40: 'black', 41: 'red', 42: 'green', 43: 'yellow', 44: 'blue', 45: 'magenta', 46: 'cyan', 47: 'white',
                        100: 'brblack', 101: 'brred', 102: 'brgreen', 103: 'bryellow', 104: 'brblue', 105: 'brmagenta', 106: 'brcyan', 107: 'brwhite',
                    }
                    pushSegment(clean.length)
                    bg = map[code] ?? bg
                }
            }
        }

        while (i < input.length) {
            const escPos = input.indexOf(ESC, i)
            if (escPos === -1) {
                clean += input.slice(i)
                break
            }
            clean += input.slice(i, escPos)
            i = escPos + ESC.length
            const mPos = input.indexOf('m', i)
            if (mPos === -1) {
                break
            }
            const seq = input.slice(i, mPos)
            const codes = seq.split(';').filter(Boolean).map(x => parseInt(x, 10)).filter(x => !isNaN(x))
            pushSegment(clean.length)
            setSgr(codes.length ? codes : [0])
            i = mPos + 1
        }
        pushSegment(clean.length)
        return { text: clean, segments }
    }

    private offsetToPosition (text: string): Array<{ start: number, line: number, col: number }> {
        const map: Array<{ start: number, line: number, col: number }> = []
        let line = 1
        let col = 1
        map.push({ start: 0, line, col })
        for (let idx = 0; idx < text.length; idx++) {
            const ch = text[idx]
            if (ch === '\n') {
                line++
                col = 1
                map.push({ start: idx + 1, line, col })
            } else {
                col++
            }
        }
        return map
    }

    private applyAnsiDecorations (doc: EditorDocument, rawContent: string): void {
        if (!this.monaco || !doc.model) {
            return
        }
        const { text, segments } = this.parseAnsi(rawContent)
        doc.model.setValue(text)
        this.setModelLanguage(doc)
        const lineMap = this.offsetToPosition(text)

        const findLine = (offset: number) => {
            let lo = 0
            let hi = lineMap.length - 1
            while (lo <= hi) {
                const mid = Math.floor((lo + hi) / 2)
                if (lineMap[mid].start <= offset && (mid === lineMap.length - 1 || lineMap[mid + 1].start > offset)) {
                    return lineMap[mid]
                }
                if (lineMap[mid].start > offset) {
                    hi = mid - 1
                } else {
                    lo = mid + 1
                }
            }
            return lineMap[0]
        }

        const decorations = segments.map(seg => {
            const startPos = findLine(seg.start)
            const endPos = findLine(seg.end)
            const startColumn = startPos.col + (seg.start - startPos.start)
            const endColumn = endPos.col + (seg.end - endPos.start)
            return {
                range: new this.monaco.Range(startPos.line, startColumn, endPos.line, endColumn),
                options: { inlineClassName: seg.classes },
            }
        })
        doc.ansiDecorationIds = doc.model.deltaDecorations(doc.ansiDecorationIds ?? [], decorations)
    }

    private async ensureRunTerminal (cwd: string): Promise<BaseTerminalTabComponentType<any>|null> {
        const terminalService = this.resolveTerminalService()
        if (!terminalService) {
            this.setError('Local terminal service unavailable')
            return null
        }
        const existing = this.runTerminalTab as (BaseTerminalTabComponentType<any> & BaseTabComponent)|null
        if (existing?.parent) {
            return existing
        }
        const runProfile = await this.resolveRunProfile()
        const term = await terminalService.openTab(runProfile, cwd, false)
        if (!term) {
            return null
        }
        // Mark this terminal as a dedicated "Run in terminal" pane so the terminal plugin can
        // show a close button inside the pane without affecting regular split panes.
        ;(term as any).__tlinkRunTerminal = true
        // Make sure the terminal toolbar (which contains the split-pane close button) is visible
        // for the code editor run terminal. Regular terminals can keep their default behavior.
        try {
            ;(term as any).enableToolbar = true
            ;(term as any).pinToolbar = true
            ;(term as any).revealToolbar = true
        } catch {}
        this.runTerminalTab = term
        ;(term as any).destroyed$?.subscribe(() => {
            if (this.runTerminalTab === term) {
                this.runTerminalTab = null
            }
        })
        await this.placeTerminalNextToEditor(term)
        return term
    }

    private async placeTerminalNextToEditor (term: BaseTerminalTabComponentType<any>): Promise<void> {
        const terminalTab = term as BaseTerminalTabComponentType<any> & BaseTabComponent
        if (terminalTab.parent === this.parent && terminalTab.parent instanceof SplitTabComponent) {
            terminalTab.parent.focus(terminalTab)
            return
        }
        if (this.parent instanceof SplitTabComponent) {
            // Prefer a bottom "console" layout for running code
            await this.parent.addTab(terminalTab, this, 'b')
            this.parent.focus(terminalTab)
            return
        }
        const idx = this.app.tabs.indexOf(this)
        this.app.removeTab(this)
        const split = this.tabsService.create({ type: SplitTabComponent })
        await split.addTab(this, null, 't')
        await split.addTab(terminalTab, this, 'b')
        this.app.addTabRaw(split, idx >= 0 ? idx : null)
        this.app.selectTab(split)
    }

    private sendToTerminal (term: BaseTerminalTabComponentType<any>, text: string): void {
        try {
            term.session?.write(Buffer.from(text))
        } catch {
            window.dispatchEvent(new CustomEvent('tlink-send-to-terminal', { detail: { text } }))
        }
    }
}
