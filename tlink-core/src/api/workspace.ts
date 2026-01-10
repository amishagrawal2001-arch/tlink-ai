import { RecoveryToken } from './tabRecovery'

/**
 * Represents a saved workspace configuration
 */
export interface Workspace {
    id: string
    name: string
    description?: string
    tabs: RecoveryToken[]
    codeEditorFolders: string[]
    profiles: string[]
    layout?: SplitLayout
    shared: boolean
    teamId?: string
    version: number
    createdAt: Date
    updatedAt: Date
    tags?: string[]
    isTemplate?: boolean
}

/**
 * Represents a split layout structure
 */
export interface SplitLayout {
    direction: 'horizontal' | 'vertical'
    sizes?: number[]
    children: Array<SplitLayout | TabLayout>
}

/**
 * Represents a tab in the layout
 */
export interface TabLayout {
    type: 'tab'
    recoveryToken: RecoveryToken
}

