# Cloud Sync & Backup Implementation Guide

## Overview

Cloud Sync & Backup enables Tlink users to:
- Sync configuration and workspaces across multiple devices
- Automatically backup data to prevent data loss
- Restore previous versions of configurations
- Support multiple storage backends (Tlink Cloud, self-hosted, S3-compatible)

---

## Executive Summary

### What is Cloud Sync & Backup?

**Cloud Sync** allows users to automatically synchronize their Tlink configuration (profiles, workspaces, settings) across multiple devices (laptop, desktop, server). When you make changes on one device, they automatically appear on your other devices.

**Backup & Restore** provides automatic backups of your configuration and workspaces, allowing you to restore previous versions if something goes wrong, similar to Time Machine on macOS or File History on Windows.

### Why Implement This?

1. **User Retention**: Users who sync across devices are more likely to stay loyal
2. **Reduced Setup Friction**: New device = instant setup with all configurations
3. **Data Protection**: Automatic backups prevent data loss
4. **Revenue Opportunity**: Premium feature for subscription tiers
5. **Enterprise Requirement**: Enterprises need sync and backup for compliance

### How It Works (High-Level)

```
Device 1 (Laptop)          Cloud Storage          Device 2 (Desktop)
     │                           │                        │
     │─── Save Config ──────────>│                        │
     │                           │                        │
     │                           │<──── Sync Request ─────│
     │                           │                        │
     │<─── Config Updated ───────┼──────── Config ────────│
     │                           │                        │
```

1. User saves configuration on Device 1
2. ConfigService triggers CloudSyncService
3. CloudSyncService uploads encrypted data to cloud
4. Device 2 periodically checks for updates
5. CloudSyncService downloads and merges changes
6. ConfigService applies merged configuration

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Tlink Application                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ ConfigService│  │WorkspaceService│  │  UI Components │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                  │                   │            │
│         └──────────────────┴───────────────────┘            │
│                            │                                │
│                   ┌────────▼────────┐                      │
│                   │ CloudSyncService │                      │
│                   └────────┬────────┘                      │
│                            │                                │
│         ┌──────────────────┼──────────────────┐            │
│         │                  │                  │            │
│  ┌──────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐    │
│  │ SyncAdapter │  │BackupService │  │EncryptionSvc │    │
│  └──────┬──────┘  └───────┬──────┘  └──────────────┘    │
│         │                  │                              │
│         └──────────────────┴──────────────────┐           │
│                                               │           │
└───────────────────────────────────────────────┼───────────┘
                                                │
                        ┌───────────────────────┴───────────┐
                        │                                     │
            ┌───────────▼──────────┐              ┌─────────▼────────┐
            │  Cloud Storage Backend│              │ Local Backup Dir │
            │  (Tlink Cloud, S3, etc)│             │  (config.yaml.bak)│
            └───────────────────────┘              └──────────────────┘
```

---

## 2.1 Multi-Device Sync Implementation

### Core Components

#### 1. CloudSyncService (New Service)

**Location**: `tlink-core/src/services/cloudSync.service.ts`

**Responsibilities**:
- Manage sync state and timestamps
- Handle conflict resolution
- Coordinate sync operations
- Support multiple backend providers
- Selective sync management

**Interface**:
```typescript
interface CloudSyncConfig {
  enabled: boolean
  provider: 'tlink-cloud' | 'self-hosted' | 's3' | 'dropbox' | 'custom'
  endpoint?: string
  credentials?: {
    accessKey?: string
    secretKey?: string
    token?: string
  }
  syncInterval: number  // seconds
  selectiveSync: {
    config: boolean
    workspaces: boolean
    profiles: boolean
    codeEditorState: boolean
  }
  lastSyncTime?: Date
  lastSyncDeviceId?: string
}

interface SyncData {
  version: string
  deviceId: string
  timestamp: Date
  config?: any
  workspaces?: Workspace[]
  profiles?: any[]
  codeEditorState?: CodeEditorState[]
  checksum: string
}

interface ConflictResolution {
  strategy: 'last-write-wins' | 'manual' | 'merge'
  localChanges?: any
  remoteChanges?: any
  resolved?: any
}
```

**Implementation Structure**:
```typescript
@Injectable({ providedIn: 'root' })
export class CloudSyncService {
  private syncConfig: CloudSyncConfig
  private syncAdapters: Map<string, SyncAdapter>
  private currentAdapter: SyncAdapter | null = null
  private syncInProgress = false
  private lastSyncTime: Date | null = null
  private deviceId: string
  
  constructor(
    private config: ConfigService,
    private workspace: WorkspaceService,
    private platform: PlatformService,
    private encryption: EncryptionService,
    log: LogService
  ) {
    this.deviceId = this.getOrCreateDeviceId()
    this.loadSyncConfig()
    this.initializeAdapters()
  }

  /**
   * Get or create unique device ID
   */
  private getOrCreateDeviceId(): string {
    let deviceId = window.localStorage.getItem('tlink_device_id')
    if (!deviceId) {
      deviceId = uuidv4()
      window.localStorage.setItem('tlink_device_id', deviceId)
    }
    return deviceId
  }

  /**
   * Initialize sync adapters for different backends
   */
  private initializeAdapters(): void {
    // Tlink Cloud adapter
    this.syncAdapters.set('tlink-cloud', new TlinkCloudAdapter(...))
    
    // S3-compatible adapter
    this.syncAdapters.set('s3', new S3Adapter(...))
    
    // Self-hosted adapter
    this.syncAdapters.set('self-hosted', new SelfHostedAdapter(...))
    
    // Custom adapter (for plugins)
    this.syncAdapters.set('custom', new CustomAdapter(...))
  }

  /**
   * Enable cloud sync with a provider
   */
  async enableSync(provider: string, credentials: any): Promise<void> {
    this.syncConfig.enabled = true
    this.syncConfig.provider = provider
    this.syncConfig.credentials = credentials
    this.currentAdapter = this.syncAdapters.get(provider)
    
    await this.currentAdapter?.authenticate(credentials)
    await this.saveSyncConfig()
    await this.sync()
  }

  /**
   * Perform a sync operation
   */
  async sync(): Promise<SyncResult> {
    if (this.syncInProgress) {
      throw new Error('Sync already in progress')
    }

    this.syncInProgress = true
    try {
      // 1. Collect local data to sync
      const localData = await this.collectLocalData()
      
      // 2. Fetch remote data
      const remoteData = await this.currentAdapter?.fetch()
      
      // 3. Detect conflicts
      const conflicts = this.detectConflicts(localData, remoteData)
      
      // 4. Resolve conflicts
      const resolved = await this.resolveConflicts(conflicts)
      
      // 5. Merge resolved data
      const merged = this.mergeData(localData, remoteData, resolved)
      
      // 6. Apply merged data locally
      await this.applyLocalData(merged)
      
      // 7. Upload to cloud
      await this.currentAdapter?.upload(merged)
      
      // 8. Update sync timestamp
      this.lastSyncTime = new Date()
      this.syncConfig.lastSyncTime = this.lastSyncTime
      await this.saveSyncConfig()
      
      return { success: true, conflicts: conflicts.length }
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * Collect local data for syncing
   */
  private async collectLocalData(): Promise<SyncData> {
    const data: SyncData = {
      version: '1.0',
      deviceId: this.deviceId,
      timestamp: new Date(),
      checksum: '',
    }

    if (this.syncConfig.selectiveSync.config) {
      data.config = this.config.store
    }

    if (this.syncConfig.selectiveSync.workspaces) {
      data.workspaces = this.workspace.getWorkspaces()
    }

    if (this.syncConfig.selectiveSync.profiles) {
      data.profiles = this.config.store.profiles
    }

    // Generate checksum for integrity
    data.checksum = await this.generateChecksum(data)
    return data
  }

  /**
   * Detect conflicts between local and remote data
   */
  private detectConflicts(local: SyncData, remote: SyncData | null): Conflict[] {
    if (!remote) return []

    const conflicts: Conflict[] = []

    // Compare timestamps and checksums
    if (local.timestamp > remote.timestamp && local.checksum !== remote.checksum) {
      conflicts.push({
        type: 'data-diverged',
        local: local,
        remote: remote,
        strategy: this.syncConfig.conflictResolution || 'last-write-wins'
      })
    }

    return conflicts
  }

  /**
   * Resolve conflicts based on strategy
   */
  private async resolveConflicts(conflicts: Conflict[]): Promise<ConflictResolution[]> {
    const resolutions: ConflictResolution[] = []

    for (const conflict of conflicts) {
      if (conflict.strategy === 'last-write-wins') {
        // Use the most recent version
        resolutions.push({
          strategy: 'last-write-wins',
          resolved: conflict.local.timestamp > conflict.remote.timestamp 
            ? conflict.local 
            : conflict.remote
        })
      } else if (conflict.strategy === 'manual') {
        // Prompt user for resolution
        const resolution = await this.promptConflictResolution(conflict)
        resolutions.push(resolution)
      } else if (conflict.strategy === 'merge') {
        // Attempt automatic merge
        const merged = this.attemptMerge(conflict.local, conflict.remote)
        resolutions.push({
          strategy: 'merge',
          resolved: merged
        })
      }
    }

    return resolutions
  }

  /**
   * Periodic sync (called via interval)
   */
  startPeriodicSync(): void {
    if (!this.syncConfig.enabled) return

    setInterval(() => {
      this.sync().catch(error => {
        this.logger.error('Periodic sync failed:', error)
      })
    }, this.syncConfig.syncInterval * 1000)
  }
}
```

#### 2. SyncAdapter Interface (Abstract Base)

**Location**: `tlink-core/src/services/syncAdapters/baseSyncAdapter.ts`

**Purpose**: Define interface for different cloud storage providers

```typescript
export abstract class SyncAdapter {
  abstract authenticate(credentials: any): Promise<void>
  abstract fetch(): Promise<SyncData | null>
  abstract upload(data: SyncData): Promise<void>
  abstract delete(path: string): Promise<void>
  abstract getSyncHistory(): Promise<SyncData[]>
}
```

#### 3. TlinkCloudAdapter (Tlink Cloud Implementation)

**Location**: `tlink-core/src/services/syncAdapters/tlinkCloudAdapter.ts`

**Features**:
- REST API integration with Tlink Cloud service
- OAuth authentication
- Incremental sync (only changed data)
- Version history

```typescript
export class TlinkCloudAdapter extends SyncAdapter {
  private apiEndpoint = 'https://cloud.tlink.sh/api/v1'
  private authToken: string | null = null

  async authenticate(credentials: any): Promise<void> {
    // OAuth flow or token-based auth
    const response = await fetch(`${this.apiEndpoint}/auth`, {
      method: 'POST',
      body: JSON.stringify(credentials)
    })
    const data = await response.json()
    this.authToken = data.token
  }

  async fetch(): Promise<SyncData | null> {
    const response = await fetch(`${this.apiEndpoint}/sync`, {
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    })
    return await response.json()
  }

  async upload(data: SyncData): Promise<void> {
    await fetch(`${this.apiEndpoint}/sync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
  }
}
```

#### 4. S3Adapter (S3-Compatible Storage)

**Location**: `tlink-core/src/services/syncAdapters/s3Adapter.ts`

**Features**:
- AWS S3, MinIO, DigitalOcean Spaces support
- Access key/secret key authentication
- Bucket-based organization

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

export class S3Adapter extends SyncAdapter {
  private s3Client: S3Client
  private bucket: string

  constructor(config: S3Config) {
    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey
      }
    })
    this.bucket = config.bucket
  }

  async upload(data: SyncData): Promise<void> {
    const key = `sync/${data.deviceId}/${data.timestamp.toISOString()}.json`
    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json'
    }))
  }

  async fetch(): Promise<SyncData | null> {
    const key = `sync/latest.json`
    const response = await this.s3Client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    }))
    const data = await response.body?.transformToString()
    return data ? JSON.parse(data) : null
  }
}
```

#### 5. EncryptionService (End-to-End Encryption)

**Location**: `tlink-core/src/services/encryption.service.ts`

**Purpose**: Encrypt sensitive data before syncing

```typescript
import * as crypto from 'crypto'

@Injectable({ providedIn: 'root' })
export class EncryptionService {
  private algorithm = 'aes-256-gcm'
  
  /**
   * Encrypt data using user's master key
   */
  encrypt(data: any, masterKey: string): EncryptedData {
    const iv = crypto.randomBytes(16)
    const key = crypto.scryptSync(masterKey, 'salt', 32)
    
    const cipher = crypto.createCipheriv(this.algorithm, key, iv)
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final()
    ])
    
    const authTag = cipher.getAuthTag()
    
    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      algorithm: this.algorithm
    }
  }

  /**
   * Decrypt data using user's master key
   */
  decrypt(encryptedData: EncryptedData, masterKey: string): any {
    const key = crypto.scryptSync(masterKey, 'salt', 32)
    const iv = Buffer.from(encryptedData.iv, 'base64')
    const authTag = Buffer.from(encryptedData.authTag, 'base64')
    
    const decipher = crypto.createDecipheriv(
      encryptedData.algorithm,
      key,
      iv
    )
    decipher.setAuthTag(authTag)
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedData.encrypted, 'base64')),
      decipher.final()
    ])
    
    return JSON.parse(decrypted.toString('utf8'))
  }

  /**
   * Derive master key from user password
   */
  deriveMasterKey(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
  }
}
```

---

## 2.2 Backup & Restore Implementation

### Core Components

#### 1. BackupService (New Service)

**Location**: `tlink-core/src/services/backup.service.ts`

**Responsibilities**:
- Automatic backups
- Point-in-time restore
- Backup management (list, delete, export)
- Multiple backup locations

```typescript
interface BackupConfig {
  enabled: boolean
  interval: number  // minutes
  retention: number  // days
  locations: BackupLocation[]
  includeWorkspaces: boolean
  includeConfig: boolean
  includeProfiles: boolean
}

interface BackupLocation {
  type: 'local' | 'cloud' | 'external'
  path: string
  credentials?: any
}

interface Backup {
  id: string
  timestamp: Date
  size: number
  location: string
  checksum: string
  metadata: {
    version: string
    deviceId: string
    items: string[]
  }
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  private backupConfig: BackupConfig
  private backups: Backup[] = []
  private backupInterval: any

  constructor(
    private config: ConfigService,
    private workspace: WorkspaceService,
    private platform: PlatformService,
    private cloudSync: CloudSyncService,
    log: LogService
  ) {
    this.loadBackupConfig()
  }

  /**
   * Create a backup of current state
   */
  async createBackup(manual: boolean = false): Promise<Backup> {
    const backup: Backup = {
      id: uuidv4(),
      timestamp: new Date(),
      size: 0,
      location: '',
      checksum: '',
      metadata: {
        version: '1.0',
        deviceId: this.getDeviceId(),
        items: []
      }
    }

    // Collect backup data
    const backupData: any = {
      config: this.config.store,
      workspaces: this.workspace.getWorkspaces(),
      timestamp: backup.timestamp
    }

    // Calculate size and checksum
    const json = JSON.stringify(backupData)
    backup.size = Buffer.byteLength(json, 'utf8')
    backup.checksum = await this.calculateChecksum(json)

    // Save to all configured locations
    for (const location of this.backupConfig.locations) {
      await this.saveToLocation(backup, backupData, location)
    }

    this.backups.push(backup)
    await this.saveBackupIndex()
    await this.cleanupOldBackups()

    return backup
  }

  /**
   * Restore from a backup
   */
  async restoreBackup(backupId: string): Promise<void> {
    const backup = this.backups.find(b => b.id === backupId)
    if (!backup) {
      throw new Error('Backup not found')
    }

    // Load backup data
    const backupData = await this.loadFromLocation(backup)

    // Verify checksum
    const json = JSON.stringify(backupData)
    const checksum = await this.calculateChecksum(json)
    if (checksum !== backup.checksum) {
      throw new Error('Backup integrity check failed')
    }

    // Restore configuration
    if (backupData.config) {
      await this.config.save()
      // Merge restore data
      Object.assign(this.config.store, backupData.config)
    }

    // Restore workspaces
    if (backupData.workspaces) {
      for (const ws of backupData.workspaces) {
        await this.workspace.saveWorkspace(ws.name, ws.description)
      }
    }

    await this.config.save()
  }

  /**
   * Export backup to file
   */
  async exportBackup(backupId: string, filePath: string): Promise<void> {
    const backup = this.backups.find(b => b.id === backupId)
    if (!backup) {
      throw new Error('Backup not found')
    }

    const backupData = await this.loadFromLocation(backup)
    const json = JSON.stringify(backupData, null, 2)
    
    await this.platform.writeFile(filePath, json)
  }

  /**
   * Import backup from file
   */
  async importBackup(filePath: string): Promise<Backup> {
    const json = await this.platform.readFile(filePath)
    const backupData = JSON.parse(json)

    const backup: Backup = {
      id: uuidv4(),
      timestamp: new Date(backupData.timestamp || new Date()),
      size: Buffer.byteLength(json, 'utf8'),
      location: filePath,
      checksum: await this.calculateChecksum(json),
      metadata: backupData.metadata || {}
    }

    // Restore the imported backup
    await this.restoreBackup(backup.id)

    return backup
  }

  /**
   * Start automatic backup schedule
   */
  startAutomaticBackups(): void {
    if (!this.backupConfig.enabled) return

    this.backupInterval = setInterval(() => {
      this.createBackup().catch(error => {
        this.logger.error('Automatic backup failed:', error)
      })
    }, this.backupConfig.interval * 60 * 1000)
  }

  /**
   * Clean up old backups based on retention policy
   */
  private async cleanupOldBackups(): Promise<void> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - this.backupConfig.retention)

    const oldBackups = this.backups.filter(b => b.timestamp < cutoffDate)
    for (const backup of oldBackups) {
      await this.deleteBackup(backup.id)
    }
  }

  /**
   * List all available backups
   */
  getBackups(): Backup[] {
    return [...this.backups].sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    )
  }
}
```

---

## Integration with Existing Services

### 1. Extend ConfigService

**Modification**: `tlink-core/src/services/config.service.ts`

```typescript
// Add sync trigger on save
async save(): Promise<void> {
  // ... existing save logic ...
  
  // Trigger cloud sync if enabled
  if (this.cloudSync?.isEnabled()) {
    this.cloudSync.sync().catch(error => {
      this.logger.warn('Sync after save failed:', error)
    })
  }
}
```

### 2. Extend WorkspaceService

**Modification**: `tlink-core/src/services/workspace.service.ts`

```typescript
// Add sync trigger after workspace operations
async saveWorkspace(...): Promise<Workspace> {
  // ... existing save logic ...
  
  // Trigger sync if enabled
  if (this.cloudSync?.isEnabled() && this.cloudSync.config.selectiveSync.workspaces) {
    this.cloudSync.sync().catch(error => {
      this.logger.warn('Sync after workspace save failed:', error)
    })
  }
  
  return workspace
}
```

---

## UI Components

### 1. Cloud Sync Settings Tab

**Location**: `tlink-settings/src/components/cloudSyncSettingsTab.component.ts`

**Features**:
- Enable/disable cloud sync
- Select provider (Tlink Cloud, S3, Self-hosted)
- Configure credentials
- Selective sync options
- Sync status and last sync time
- Manual sync button
- Conflict resolution settings

### 2. Backup Settings Tab

**Location**: `tlink-settings/src/components/backupSettingsTab.component.ts`

**Features**:
- Enable/disable automatic backups
- Configure backup interval
- Select backup locations
- Backup retention policy
- Manual backup button
- List of backups with restore option
- Export/import backups

---

## Configuration File Structure

### Sync Configuration

**Location**: `~/.config/tlink/config.yaml`

```yaml
cloudSync:
  enabled: false
  provider: 'tlink-cloud'  # or 's3', 'self-hosted', 'custom'
  endpoint: 'https://cloud.tlink.sh/api/v1'
  credentials:
    token: 'encrypted-token'
  syncInterval: 300  # 5 minutes
  conflictResolution: 'last-write-wins'  # or 'manual', 'merge'
  selectiveSync:
    config: true
    workspaces: true
    profiles: true
    codeEditorState: true
  lastSyncTime: '2026-01-09T18:25:30.000Z'
  lastSyncDeviceId: 'device-uuid-123'

backup:
  enabled: true
  interval: 60  # minutes
  retention: 30  # days
  locations:
    - type: 'local'
      path: '~/.config/tlink/backups'
    - type: 'cloud'
      path: 's3://tlink-backups/user-123'
      credentials:
        accessKey: 'encrypted-key'
        secretKey: 'encrypted-secret'
  includeWorkspaces: true
  includeConfig: true
  includeProfiles: true
```

---

## Implementation Steps

### Phase 1: Foundation (Week 1-2)
1. ✅ Create `CloudSyncService` interface and base implementation
2. ✅ Create `BackupService` with local backup support
3. ✅ Create `EncryptionService` for data encryption
4. ✅ Extend `ConfigService` to trigger sync on save
5. ✅ Add sync/backup configuration to config defaults

### Phase 2: Tlink Cloud Integration (Week 3-4)
1. ✅ Implement `TlinkCloudAdapter`
2. ✅ Create Tlink Cloud REST API specification
3. ✅ Implement OAuth authentication flow
4. ✅ Add UI components for cloud sync setup
5. ✅ Test sync flow end-to-end

### Phase 3: Multiple Backend Support (Week 5-6)
1. ✅ Implement `S3Adapter` for S3-compatible storage
2. ✅ Implement `SelfHostedAdapter` for self-hosted servers
3. ✅ Create adapter registry for plugin-based adapters
4. ✅ Add UI for backend selection and configuration

### Phase 4: Advanced Features (Week 7-8)
1. ✅ Implement conflict resolution strategies
2. ✅ Add point-in-time restore for backups
3. ✅ Implement incremental sync (delta sync)
4. ✅ Add backup export/import functionality
5. ✅ Add sync history and audit logs

### Phase 5: Testing & Polish (Week 9-10)
1. ✅ Unit tests for all services
2. ✅ Integration tests for sync/backup flows
3. ✅ UI/UX improvements
4. ✅ Performance optimization
5. ✅ Documentation and user guides

---

## Security Considerations

### 1. End-to-End Encryption
- All sensitive data encrypted before upload
- Master key derived from user password
- Keys never transmitted to server
- Use AES-256-GCM for encryption

### 2. Authentication
- OAuth 2.0 for Tlink Cloud
- Access keys for S3 (stored encrypted)
- Token refresh for long-lived sessions

### 3. Data Privacy
- User controls what data is synced
- Selective sync options
- Local-only mode available
- Data retention policies

### 4. Integrity
- Checksums for all synced data
- Signature verification
- Backup integrity checks
- Conflict detection

---

## Error Handling & Resilience

### 1. Network Failures
- Retry logic with exponential backoff
- Queue sync operations for retry
- Offline mode support
- Sync resume after network reconnection

### 2. Conflict Handling
- Automatic conflict detection
- User prompts for manual resolution
- Merge strategies for compatible changes
- Conflict history and resolution tracking

### 3. Data Loss Prevention
- Atomic operations where possible
- Backup before restore
- Version history retention
- Rollback capability

---

## Performance Optimization

### 1. Incremental Sync
- Only sync changed data
- Delta compression
- Batch operations
- Lazy loading of large data

### 2. Background Processing
- Sync in background thread
- Non-blocking UI operations
- Progress indicators
- Cancel capability

### 3. Caching
- Cache remote data locally
- Reduce API calls
- Smart refresh strategies
- Local-first approach

---

## Testing Strategy

### 1. Unit Tests
- CloudSyncService methods
- Conflict resolution algorithms
- Encryption/decryption
- Backup creation/restore

### 2. Integration Tests
- End-to-end sync flow
- Multiple device scenarios
- Conflict scenarios
- Backup/restore flows

### 3. Manual Testing
- Setup cloud sync
- Test with real cloud providers
- Multi-device sync testing
- Backup/restore operations

---

## Migration Path

### For Existing Users
1. **Opt-in**: Cloud sync is disabled by default
2. **Migration tool**: One-time migration of existing config
3. **Backward compatibility**: Works with existing local config
4. **Gradual rollout**: Enable features incrementally

### For New Users
1. **Onboarding**: Cloud sync setup during first run (optional)
2. **Default settings**: Sensible defaults for free tier
3. **Tutorial**: Guided setup for cloud sync
4. **Quick start**: Pre-configured templates

---

## Monitoring & Analytics

### Metrics to Track
- Sync success/failure rates
- Sync duration
- Conflict frequency
- Backup creation success
- Restore operations
- Storage usage
- API call rates

### Logging
- Sync operations (timestamp, device, result)
- Conflict resolutions
- Backup creation/restore
- Error details
- Performance metrics

---

## Future Enhancements

### Phase 2 Features
- Real-time sync (WebSocket-based)
- Collaborative editing (multiple users)
- Sync groups (team sync)
- Advanced merge strategies
- Sync conflict UI with visual diff

### Phase 3 Features
- Version control integration (Git-based sync)
- Sync analytics dashboard
- Automated backup scheduling
- Cloud-to-cloud backup (redundancy)
- Mobile app sync support

---

## Revenue Model Integration

### Free Tier
- 1 device sync
- Basic backup (local only)
- 5MB cloud storage
- Manual sync only

### Premium Tier ($9.99/month)
- Unlimited device sync
- Cloud backup included
- 10GB cloud storage
- Automatic sync
- Priority support

### Enterprise Tier (Custom)
- Unlimited devices
- Self-hosted sync server
- Unlimited storage
- Advanced security features
- Dedicated support
- Custom integrations

---

This implementation provides a robust, scalable foundation for cloud sync and backup that can grow with the product while maintaining security and user privacy as top priorities.

---

## Integration with Existing Codebase

### Current Architecture Integration Points

#### 1. ConfigService Integration
The existing `ConfigService` at `tlink-core/src/services/config.service.ts` already has:
- ✅ `save()` method that writes to local file
- ✅ `load()` method that reads from local file
- ✅ `changed$` Observable for change notifications
- ✅ `emitChange()` method for broadcasting changes

**Integration Strategy**:
```typescript
// In ConfigService.save() method (around line 204)
async save(): Promise<void> {
    // ... existing save logic ...
    await this.platform.saveConfig(yaml.dump(cleanStore))
    this.emitChange()
    
    // NEW: Trigger cloud sync if enabled
    // Note: Use optional injection to avoid circular dependencies
    const cloudSync = this.injector?.get(CloudSyncService, null, { optional: true })
    if (cloudSync?.isEnabled() && cloudSync.shouldSync('config')) {
        // Defer sync to avoid blocking save operation
        setTimeout(() => {
            cloudSync.sync('config').catch(error => {
                this.logger.warn('Sync after config save failed:', error)
            })
        }, 1000) // 1 second delay to debounce rapid saves
    }
}
```

#### 2. WorkspaceService Integration
The existing `WorkspaceService` already has:
- ✅ `saveWorkspace()` method
- ✅ `getWorkspaces()` method
- ✅ Workspaces stored in config.store.workspaces

**Integration Strategy**:
```typescript
// In WorkspaceService.saveWorkspace() method (around line 59)
async saveWorkspace(...): Promise<Workspace> {
    // ... existing save logic ...
    await this.config.save()
    
    // NEW: Trigger cloud sync for workspaces
    const cloudSync = this.injector?.get(CloudSyncService, null, { optional: true })
    if (cloudSync?.isEnabled() && cloudSync.shouldSync('workspaces')) {
        setTimeout(() => {
            cloudSync.sync('workspaces').catch(error => {
                this.logger.warn('Sync after workspace save failed:', error)
            })
        }, 1000)
    }
    
    return workspace
}
```

#### 3. PlatformService Integration
The existing `PlatformService` already has:
- ✅ `loadConfig()` method
- ✅ `saveConfig()` method
- ✅ File system access methods

**No changes needed** - CloudSyncService will work alongside existing file-based config.

#### 4. VaultService Integration
The existing `VaultService` already handles encryption for secrets. We'll use similar patterns but with:
- **Different scope**: Encrypt entire sync payload, not just secrets
- **User-controlled keys**: Master key derived from user password
- **Separate from vault**: Cloud sync encryption is independent

---

## Practical Implementation Example

### Step-by-Step: Setting Up Cloud Sync

#### User Flow:
1. User opens Settings → Cloud Sync
2. Clicks "Enable Cloud Sync"
3. Selects provider (Tlink Cloud, S3, Self-hosted)
4. Enters credentials
5. Chooses what to sync (profiles, workspaces, config, code editor state)
6. Clicks "Start Sync"
7. System authenticates and performs initial sync
8. Periodic sync starts automatically

#### Code Flow:
```typescript
// 1. User clicks "Enable Cloud Sync" in UI
cloudSyncSettingsTab.enableSync('tlink-cloud', credentials)

// 2. CloudSyncService.enableSync() called
async enableSync(provider: string, credentials: any): Promise<void> {
    // Validate credentials
    await this.authenticate(provider, credentials)
    
    // Save config
    this.syncConfig.enabled = true
    this.syncConfig.provider = provider
    await this.saveSyncConfig()
    
    // Perform initial sync
    await this.sync()
    
    // Start periodic sync
    this.startPeriodicSync()
}

// 3. Sync operation
async sync(): Promise<SyncResult> {
    // Collect local data
    const local = await this.collectLocalData()
    // { config: {...}, workspaces: [...], timestamp: Date, checksum: "abc123" }
    
    // Fetch remote data
    const remote = await this.adapter.fetch()
    // { config: {...}, workspaces: [...], timestamp: Date, checksum: "xyz789" }
    
    // Detect conflicts
    if (local.checksum !== remote.checksum && 
        local.timestamp !== remote.timestamp) {
        // Conflict detected!
        const conflict = await this.resolveConflict(local, remote)
        const merged = this.merge(local, remote, conflict)
        
        // Apply merged data locally
        await this.applyLocalData(merged)
        
        // Upload merged data
        await this.adapter.upload(merged)
    } else if (local.timestamp > remote.timestamp) {
        // Local is newer, upload
        await this.adapter.upload(local)
    } else if (remote.timestamp > local.timestamp) {
        // Remote is newer, download
        await this.applyLocalData(remote)
    }
}
```

---

## Conflict Resolution Strategies

### 1. Last-Write-Wins (Default)
**When to use**: Simple use case, user trusts latest changes
```typescript
if (local.timestamp > remote.timestamp) {
    return local  // Use local (most recent)
} else {
    return remote  // Use remote (most recent)
}
```

### 2. Manual Resolution (Enterprise)
**When to use**: Critical data, user wants control
```typescript
// Show UI modal with both versions
const resolution = await this.showConflictResolutionModal({
    local: {
        config: local.config,
        timestamp: local.timestamp,
        device: local.deviceId
    },
    remote: {
        config: remote.config,
        timestamp: remote.timestamp,
        device: remote.deviceId
    }
})
return resolution.selectedConfig
```

### 3. Smart Merge (Advanced)
**When to use**: Non-conflicting changes, automatic merge possible
```typescript
// Merge only non-conflicting fields
const merged = {
    config: deepMerge(local.config, remote.config, {
        conflictResolution: 'useNewest'
    }),
    workspaces: mergeWorkspaces(local.workspaces, remote.workspaces),
    timestamp: new Date(),  // Current time
    deviceId: this.deviceId  // Current device
}
```

---

## Data Flow Diagram

### Sync Flow:
```
┌─────────────────────────────────────────────────────────────┐
│                    User Action                              │
│              (Save Config/Workspace)                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              ConfigService.save()                           │
│              or WorkspaceService.saveWorkspace()            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│          CloudSyncService.sync() [Triggered]                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Collect Local Data                               │  │
│  │    - Config from ConfigService                      │  │
│  │    - Workspaces from WorkspaceService               │  │
│  │    - Profiles from ConfigService                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 2. Encrypt Data (EncryptionService)                 │  │
│  │    - Use user's master key                          │  │
│  │    - AES-256-GCM encryption                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 3. Fetch Remote Data (Adapter)                      │  │
│  │    - GET /api/v1/sync                               │  │
│  │    - Returns encrypted data                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 4. Detect Conflicts                                 │  │
│  │    - Compare checksums                              │  │
│  │    - Compare timestamps                             │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│         ┌───────────┴───────────┐                          │
│         │                       │                          │
│      Conflict?              No Conflict                   │
│         │                       │                          │
│         ▼                       ▼                          │
│  ┌──────────────┐    ┌──────────────────┐                │
│  │ 5. Resolve   │    │ Use latest       │                │
│  │    Conflicts │    │ version          │                │
│  └──────┬───────┘    └────────┬─────────┘                │
│         │                     │                            │
│         └──────────┬──────────┘                            │
│                    ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 6. Upload Merged Data (Adapter)                     │  │
│  │    - POST /api/v1/sync                              │  │
│  │    - Upload encrypted data                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 7. Apply Changes Locally (if needed)                │  │
│  │    - Update ConfigService                           │  │
│  │    - Update WorkspaceService                        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Backup Flow:
```
┌─────────────────────────────────────────────────────────────┐
│            Automatic Backup (Scheduled)                     │
│            or Manual Backup (User Action)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│          BackupService.createBackup()                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Collect Data                                     │  │
│  │    - Config from ConfigService                      │  │
│  │    - Workspaces from WorkspaceService               │  │
│  │    - Profiles from ConfigService                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 2. Create Backup Metadata                           │  │
│  │    - Generate UUID                                  │  │
│  │    - Timestamp                                      │  │
│  │    - Calculate checksum                             │  │
│  │    - Calculate size                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 3. Save to All Locations                            │  │
│  │    - Local: ~/.config/tlink/backups/                │  │
│  │    - Cloud: S3/Cloud Storage                        │  │
│  │    - External: User-specified path                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 4. Update Backup Index                              │  │
│  │    - Store backup metadata                          │  │
│  │    - Track backup locations                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 5. Cleanup Old Backups                              │  │
│  │    - Remove backups older than retention period     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Dependencies & Packages

### Required NPM Packages:

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",  // For S3 adapter
    "axios": "^1.0.0",  // For HTTP requests (Tlink Cloud)
    "crypto-js": "^4.1.0",  // For encryption utilities
    "diff": "^5.0.0",  // For conflict detection
    "node-cron": "^3.0.0"  // For scheduled backups
  },
  "devDependencies": {
    "@types/node-cron": "^3.0.0"
  }
}
```

### Existing Packages Already Available:
- ✅ `uuid` - Already used for ID generation
- ✅ `yaml` - Already used for config serialization
- ✅ `rxjs` - Already used for observables

---

## Configuration File Structure

### Extended Config Structure:

```yaml
# ~/.config/tlink/config.yaml

# Existing config sections...
profiles: [...]
appearance: {...}
hotkeys: {...}

# NEW: Cloud Sync Configuration
cloudSync:
  enabled: false
  provider: 'tlink-cloud'  # Options: 'tlink-cloud', 's3', 'self-hosted', 'custom'
  
  # Tlink Cloud Configuration
  tlinkCloud:
    endpoint: 'https://cloud.tlink.sh/api/v1'
    token: 'encrypted-token-here'  # Encrypted using VaultService
    refreshToken: 'encrypted-refresh-token'
    
  # S3 Configuration
  s3:
    endpoint: 'https://s3.amazonaws.com'
    region: 'us-east-1'
    bucket: 'tlink-backups-user123'
    accessKey: 'encrypted-access-key'  # Encrypted
    secretKey: 'encrypted-secret-key'  # Encrypted
    
  # Self-hosted Configuration
  selfHosted:
    endpoint: 'https://self-hosted-tlink.example.com/api/v1'
    apiKey: 'encrypted-api-key'
    
  # Sync Settings
  syncInterval: 300  # seconds (5 minutes)
  conflictResolution: 'last-write-wins'  # Options: 'last-write-wins', 'manual', 'merge'
  
  # Selective Sync - Choose what to sync
  selectiveSync:
    config: true
    workspaces: true
    profiles: true
    codeEditorState: true
    hotkeys: false  # Usually device-specific
    appearance: false  # Usually device-specific
  
  # Sync Metadata
  lastSyncTime: '2026-01-09T18:25:30.000Z'
  lastSyncDeviceId: 'device-uuid-123'
  syncVersion: '1.0'

# NEW: Backup Configuration
backup:
  enabled: true
  interval: 60  # minutes
  retention: 30  # days
  
  # Backup Locations (multiple locations for redundancy)
  locations:
    - type: 'local'
      path: '~/.config/tlink/backups'
      enabled: true
    - type: 's3'
      path: 's3://tlink-backups/user-123'
      enabled: true
      credentials:
        accessKey: 'encrypted-key'
        secretKey: 'encrypted-secret'
    - type: 'external'
      path: '/Volumes/Backup/tlink-backups'
      enabled: false
  
  # What to include in backups
  include:
    config: true
    workspaces: true
    profiles: true
    codeEditorState: true
  
  # Backup Metadata
  lastBackupTime: '2026-01-09T18:25:30.000Z'
  backupCount: 42
```

---

## Security Architecture

### Encryption Flow:

```
┌─────────────────────────────────────────────────────────────┐
│                    User Password                            │
│                  (User Input)                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│        PBKDF2 Key Derivation (100,000 iterations)          │
│        Salt: User-specific salt (stored locally)           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Master Key (32 bytes)                          │
│        (Never transmitted, never stored)                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              AES-256-GCM Encryption                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Plain Data (Config/Workspaces)                      │  │
│  │ + IV (Initialization Vector - random 16 bytes)      │  │
│  │ + Auth Tag (Authentication - 16 bytes)              │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Encrypted Data (Base64 encoded)                     │  │
│  │ {                                                    │  │
│  │   encrypted: "...",                                 │  │
│  │   iv: "...",                                        │  │
│  │   authTag: "...",                                   │  │
│  │   algorithm: "aes-256-gcm"                          │  │
│  │ }                                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                     │                                        │
│                     ▼                                        │
│         Upload to Cloud Storage                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Management:

1. **Master Key**: Derived from user password using PBKDF2
2. **Storage**: Master key never stored, always derived on-demand
3. **Password Reset**: Requires re-encryption of all data (or key recovery mechanism)
4. **Key Recovery**: Optional recovery keys (encrypted backup of master key)

---

## Error Handling & Edge Cases

### Common Error Scenarios:

#### 1. Network Failure During Sync
```typescript
try {
    await this.adapter.upload(data)
} catch (error) {
    if (error.code === 'NETWORK_ERROR') {
        // Queue for retry
        this.retryQueue.push({ data, timestamp: Date.now() })
        this.scheduleRetry()
        throw new SyncError('Network error, will retry', { retryable: true })
    }
}
```

#### 2. Conflict During Simultaneous Edits
```typescript
// Device 1 saves at T1
// Device 2 saves at T2 (while Device 1 is uploading)
// Device 2 syncs and sees Device 1's changes
// → Conflict detected, resolve using strategy
```

#### 3. Corrupted Backup
```typescript
async restoreBackup(backupId: string): Promise<void> {
    const backup = await this.loadBackup(backupId)
    
    // Verify checksum
    const calculatedChecksum = await this.calculateChecksum(backup.data)
    if (calculatedChecksum !== backup.checksum) {
        throw new BackupError('Backup integrity check failed - backup may be corrupted')
    }
    
    // Verify encryption
    try {
        const decrypted = await this.encryption.decrypt(backup.data, masterKey)
    } catch (error) {
        throw new BackupError('Backup decryption failed - wrong password or corrupted data')
    }
}
```

#### 4. Storage Quota Exceeded
```typescript
async upload(data: SyncData): Promise<void> {
    try {
        await this.adapter.upload(data)
    } catch (error) {
        if (error.code === 'QUOTA_EXCEEDED') {
            // Clean up old backups
            await this.cleanupOldBackups()
            // Notify user
            this.notifyUser('Storage quota exceeded. Old backups cleaned up.')
            // Retry
            await this.adapter.upload(data)
        }
    }
}
```

---

## Performance Considerations

### Optimization Strategies:

1. **Incremental Sync**: Only sync changed data
   ```typescript
   // Track what changed
   interface SyncDelta {
       configChanged: boolean
       workspaceIds: string[]  // Only changed workspace IDs
       profileIds: string[]    // Only changed profile IDs
   }
   ```

2. **Debouncing**: Prevent rapid-fire syncs
   ```typescript
   private syncDebounceTimer: any
   triggerSync(): void {
       clearTimeout(this.syncDebounceTimer)
       this.syncDebounceTimer = setTimeout(() => {
           this.sync()
       }, 2000)  // Wait 2 seconds after last change
   }
   ```

3. **Background Processing**: Don't block UI
   ```typescript
   // Use Web Workers or background threads
   async sync(): Promise<void> {
       return new Promise((resolve, reject) => {
           // Perform sync in background
           this.backgroundSync(syncData => {
               resolve(syncData)
           })
       })
   }
   ```

4. **Compression**: Reduce data size
   ```typescript
   import { gzip, gunzip } from 'zlib'
   
   const compressed = await gzip(JSON.stringify(data))
   // Upload compressed data (smaller, faster)
   ```

5. **Caching**: Reduce API calls
   ```typescript
   private syncCache: Map<string, { data: any, timestamp: Date }>
   
   async fetch(): Promise<SyncData | null> {
       const cached = this.syncCache.get('latest')
       if (cached && Date.now() - cached.timestamp.getTime() < 5000) {
           return cached.data  // Use cache if < 5 seconds old
       }
       // Fetch from server
       const fresh = await this.adapter.fetch()
       this.syncCache.set('latest', { data: fresh, timestamp: new Date() })
       return fresh
   }
   ```

---

## Testing Strategy

### Unit Tests:

```typescript
describe('CloudSyncService', () => {
    it('should collect local data correctly', async () => {
        const service = new CloudSyncService(...)
        const data = await service.collectLocalData()
        expect(data.config).toBeDefined()
        expect(data.workspaces).toBeDefined()
        expect(data.checksum).toBeDefined()
    })
    
    it('should detect conflicts correctly', () => {
        const local: SyncData = { checksum: 'abc123', timestamp: new Date('2026-01-09') }
        const remote: SyncData = { checksum: 'xyz789', timestamp: new Date('2026-01-08') }
        const conflicts = service.detectConflicts(local, remote)
        expect(conflicts.length).toBeGreaterThan(0)
    })
    
    it('should resolve conflicts using last-write-wins', () => {
        const local = { timestamp: new Date('2026-01-09') }
        const remote = { timestamp: new Date('2026-01-08') }
        const resolved = service.resolveConflict(local, remote, 'last-write-wins')
        expect(resolved).toEqual(local)
    })
})
```

### Integration Tests:

```typescript
describe('Cloud Sync Integration', () => {
    it('should sync config changes across devices', async () => {
        // Setup: Two mock devices
        const device1 = new MockDevice('device-1')
        const device2 = new MockDevice('device-2')
        
        // Action: Device 1 makes change
        device1.config.store.appearance.theme = 'dark'
        await device1.config.save()
        await device1.cloudSync.sync()
        
        // Wait for sync interval
        await sleep(5000)
        
        // Verify: Device 2 receives changes
        await device2.cloudSync.sync()
        expect(device2.config.store.appearance.theme).toBe('dark')
    })
})
```

---

## Migration & Rollout Strategy

### Phase 1: MVP (Minimum Viable Product)
- ✅ Local backup only
- ✅ Manual sync only
- ✅ Single device support
- ✅ Basic conflict resolution (last-write-wins)

### Phase 2: Cloud Integration
- ✅ Tlink Cloud adapter
- ✅ Automatic sync
- ✅ Multi-device support
- ✅ OAuth authentication

### Phase 3: Advanced Features
- ✅ Multiple backend support (S3, self-hosted)
- ✅ Advanced conflict resolution
- ✅ Incremental sync
- ✅ Point-in-time restore

### Phase 4: Enterprise Features
- ✅ SSO integration
- ✅ Team sync
- ✅ Audit logging
- ✅ Compliance features

---

## Summary

Cloud Sync & Backup is a foundational feature that:
- **Enhances user experience** by providing seamless multi-device access
- **Protects user data** through automatic backups
- **Drives revenue** through premium subscriptions
- **Enables enterprise sales** through compliance features

The implementation is designed to:
- ✅ **Integrate seamlessly** with existing ConfigService and WorkspaceService
- ✅ **Maintain security** through end-to-end encryption
- ✅ **Scale efficiently** through incremental sync and compression
- ✅ **Handle errors gracefully** with retry logic and conflict resolution
- ✅ **Support multiple backends** through adapter pattern
- ✅ **Provide user control** through selective sync options

This implementation provides a robust, scalable foundation for cloud sync and backup that can grow with the product while maintaining security and user privacy as top priorities.

