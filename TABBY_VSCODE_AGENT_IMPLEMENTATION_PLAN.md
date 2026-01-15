# Tabby VSCode Agent Implementation Plan for Tlink

## Overview
This document outlines the plan to implement and integrate the `tabby-vscode-agent` plugin into Tlink. The plugin provides AI-powered terminal control and automation through MCP (Model Context Protocol) server integration with VS Code.

## Current State Analysis

### Plugin Structure
- **Location**: `/tabby-vscode-agent/`
- **Type**: Tabby plugin (needs adaptation for Tlink)
- **Main Features**:
  - MCP Server (HTTP/SSE and stdio)
  - Terminal command execution
  - SSH session management
  - Command history and output storage
  - VS Code integration tools
  - Dialog management
  - Hotkey support

### Key Components
1. **MCP Service** (`src/services/mcpService.ts`) - Main server implementation
2. **Tool Categories**:
   - `ExecToolCategory` - Terminal execution tools
   - `VSCodeToolCategory` - VS Code integration tools
3. **UI Components**:
   - Settings tab
   - Command dialogs
   - Command history modal
   - Running commands dialog
4. **Services**:
   - Dialog management
   - Command history
   - Command output storage
   - URL opening
   - Hotkey management

## Implementation Plan

### Phase 1: Plugin Renaming and Structure Setup

#### 1.1 Rename Plugin Directory
- [ ] Rename `tabby-vscode-agent/` to `tlink-vscode-agent/`
- [ ] Update all internal references

#### 1.2 Update Package Configuration
- [ ] Update `package.json`:
  - Change `name` from `tabby-vscode-agent` to `tlink-vscode-agent`
  - Update `keywords` to include `tlink-plugin`
  - Update `peerDependencies`:
    - `tabby-core` → `tlink-core`
    - `tabby-settings` → `tlink-settings`
    - `tabby-terminal` → `tlink-terminal`
  - Update `devDependencies` similarly

#### 1.3 Update TypeScript Configuration
- [ ] Update `tsconfig.json` path mappings:
  - `tabby-*` → `tlink-*`
- [ ] Update `tsconfig.typings.json` if exists

### Phase 2: Code Migration

#### 2.1 Update Imports (Critical)
**Files to update:**
- [ ] `src/index.ts` - Main module file
- [ ] `src/services/mcpService.ts`
- [ ] `src/services/*.ts` - All service files
- [ ] `src/tools/**/*.ts` - All tool files
- [ ] `src/components/**/*.ts` - All component files
- [ ] `src/settings.ts`
- [ ] `src/toolbarButtonProvider.ts`

**Import changes:**
```typescript
// Before
import TabbyCoreModule, { ... } from 'tabby-core';
import { ... } from 'tabby-settings';
import { ... } from 'tabby-terminal';

// After
import TlinkCorePlugin, { ... } from 'tlink-core';
import { ... } from 'tlink-settings';
import { ... } from 'tlink-terminal';
```

#### 2.2 Update Module Declaration
- [ ] Update `src/index.ts`:
  - Change `TabbyCoreModule` → `TlinkCorePlugin`
  - Update module class name if needed
  - Verify all providers are compatible

#### 2.3 Update Component Templates
- [ ] Check all `.pug` files for Tabby-specific references
- [ ] Update any hardcoded "Tabby" strings to "Tlink" in UI
- [ ] Verify template syntax compatibility

### Phase 3: API Compatibility Check

#### 3.1 Core API Compatibility
- [ ] Verify `AppService` API compatibility
- [ ] Verify `ConfigService` API compatibility
- [ ] Verify `BaseTabComponent` API compatibility
- [ ] Verify `HostWindowService` API compatibility

#### 3.2 Terminal API Compatibility
- [ ] Verify `BaseTerminalTabComponent` API compatibility
- [ ] Verify `XTermFrontend` API compatibility
- [ ] Test terminal session discovery
- [ ] Test command execution
- [ ] Test terminal buffer reading

#### 3.3 Settings API Compatibility
- [ ] Verify `SettingsTabProvider` API compatibility
- [ ] Test settings tab registration
- [ ] Verify config provider compatibility

### Phase 4: Build System Integration

#### 4.1 Webpack Configuration
- [ ] Update `webpack.config.mjs`:
  - Update path mappings
  - Verify build output paths
  - Check plugin build process

#### 4.2 Build Scripts
- [ ] Update build scripts if needed
- [ ] Test plugin build process
- [ ] Verify typings generation

#### 4.3 Integration with Tlink Build
- [ ] Add plugin to Tlink's plugin discovery
- [ ] Verify plugin loading mechanism
- [ ] Test plugin initialization

### Phase 5: Feature-Specific Updates

#### 5.1 MCP Server
- [ ] Verify Express server setup
- [ ] Test HTTP/SSE transport
- [ ] Test stdio transport (if used)
- [ ] Verify CORS configuration
- [ ] Test tool registration

#### 5.2 Terminal Tools
- [ ] Test `exec_command` tool
- [ ] Test `get_terminal_buffer` tool
- [ ] Test `get_ssh_session_list` tool
- [ ] Test `get_command_output` tool
- [ ] Test `open-vscode-chat` tool

#### 5.3 Dialog System
- [ ] Test command confirmation dialogs
- [ ] Test command result dialogs
- [ ] Test running commands dialog
- [ ] Test command history modal
- [ ] Verify dialog management service

#### 5.4 Settings UI
- [ ] Test MCP settings tab
- [ ] Verify port configuration
- [ ] Test "start on boot" functionality
- [ ] Test server start/stop controls
- [ ] Verify settings persistence

### Phase 6: Testing and Validation

#### 6.1 Unit Testing
- [ ] Test service initialization
- [ ] Test tool registration
- [ ] Test command execution flow
- [ ] Test dialog management

#### 6.2 Integration Testing
- [ ] Test plugin loading
- [ ] Test MCP server startup
- [ ] Test VS Code connection
- [ ] Test command execution end-to-end
- [ ] Test command history
- [ ] Test command output storage

#### 6.3 UI Testing
- [ ] Test settings tab UI
- [ ] Test command dialogs
- [ ] Test toolbar buttons
- [ ] Test hotkeys
- [ ] Test responsive design

### Phase 7: Documentation and Cleanup

#### 7.1 Documentation Updates
- [ ] Update README.md:
  - Change Tabby references to Tlink
  - Update installation instructions
  - Update usage examples
  - Update API documentation
- [ ] Update CHANGELOG.md
- [ ] Add Tlink-specific documentation

#### 7.2 Code Cleanup
- [ ] Remove Tabby-specific comments
- [ ] Update code comments
- [ ] Remove unused dependencies
- [ ] Optimize imports

#### 7.3 Asset Updates
- [ ] Update images/assets if they reference Tabby
- [ ] Update GIFs/demos if needed

## Detailed File-by-File Migration Checklist

### Core Files
- [ ] `src/index.ts` - Main module
- [ ] `src/settings.ts` - Settings provider
- [ ] `src/toolbarButtonProvider.ts` - Toolbar integration

### Services
- [ ] `src/services/mcpService.ts` - MCP server
- [ ] `src/services/mcpConfigProvider.ts` - Config provider
- [ ] `src/services/mcpLogger.service.ts` - Logging
- [ ] `src/services/dialog.service.ts` - Dialog service
- [ ] `src/services/dialogManager.service.ts` - Dialog manager
- [ ] `src/services/minimizedDialogManager.service.ts` - Minimized dialogs
- [ ] `src/services/commandHistoryManager.service.ts` - Command history
- [ ] `src/services/runningCommandsManager.service.ts` - Running commands
- [ ] `src/services/commandOutputStorage.service.ts` - Output storage
- [ ] `src/services/mcpHotkey.service.ts` - Hotkey service
- [ ] `src/services/mcpHotkeyProvider.service.ts` - Hotkey provider
- [ ] `src/services/urlOpening.service.ts` - URL opening

### Tools
- [ ] `src/tools/base-tool-category.ts` - Base tool category
- [ ] `src/tools/shell-strategy.ts` - Shell strategy
- [ ] `src/tools/terminal.ts` - Terminal tool category
- [ ] `src/tools/vscode-tool-category.ts` - VS Code tool category
- [ ] `src/tools/terminal/*.ts` - All terminal tools

### Components
- [ ] `src/components/mcpSettingsTab.component.ts` - Settings tab
- [ ] `src/components/execCommandButton.component.ts` - Exec button
- [ ] `src/components/confirmCommandDialog.component.ts` - Confirm dialog
- [ ] `src/components/commandResultDialog.component.ts` - Result dialog
- [ ] `src/components/commandHistoryModal.component.ts` - History modal
- [ ] `src/components/runningCommandsDialog.component.ts` - Running commands
- [ ] `src/components/minimizedModal.component.ts` - Minimized modal
- [ ] `src/components/extensionRecommendationDialog.component.ts` - Extension dialog

### Configuration Files
- [ ] `package.json` - Package configuration
- [ ] `tsconfig.json` - TypeScript config
- [ ] `tsconfig.typings.json` - Typings config
- [ ] `webpack.config.mjs` - Webpack config

## Potential Issues and Solutions

### Issue 1: API Differences
**Problem**: Tlink APIs might differ from Tabby APIs
**Solution**: 
- Create compatibility layer if needed
- Update code to use Tlink APIs
- Test thoroughly

### Issue 2: Module Loading
**Problem**: Plugin might not load correctly
**Solution**:
- Verify plugin discovery mechanism
- Check module exports
- Test plugin initialization

### Issue 3: Build System
**Problem**: Build might fail due to path issues
**Solution**:
- Update all path mappings
- Verify webpack configuration
- Test build process

### Issue 4: Runtime Errors
**Problem**: Runtime errors due to missing dependencies
**Solution**:
- Verify all dependencies are available
- Check peer dependencies
- Test in clean environment

## Success Criteria

1. ✅ Plugin builds successfully
2. ✅ Plugin loads in Tlink without errors
3. ✅ MCP server starts and accepts connections
4. ✅ All tools are registered and functional
5. ✅ Settings tab is accessible and functional
6. ✅ Command execution works correctly
7. ✅ Command history and output storage work
8. ✅ VS Code integration works
9. ✅ All dialogs and modals work correctly
10. ✅ Hotkeys are functional

## Timeline Estimate

- **Phase 1-2** (Setup & Migration): 2-3 days
- **Phase 3** (API Compatibility): 1-2 days
- **Phase 4** (Build Integration): 1 day
- **Phase 5** (Feature Updates): 2-3 days
- **Phase 6** (Testing): 2-3 days
- **Phase 7** (Documentation): 1 day

**Total Estimated Time**: 9-13 days

## Next Steps

1. Start with Phase 1: Rename and update package.json
2. Proceed with Phase 2: Update all imports
3. Test after each phase to catch issues early
4. Document any API differences found
5. Create compatibility layer if needed

## Usage and Workflow Guide

### Installation

#### Method 1: Install from Plugin Manager
1. Open Tlink settings
2. Navigate to **Plugins** section
3. Search for "VSCode Agent" or "tlink-vscode-agent"
4. Click **Install**
5. Restart Tlink to complete installation

#### Method 2: Manual Installation
1. Clone or download the plugin to your plugins directory
2. Navigate to the plugin directory: `cd ~/.config/tlink/plugins/tlink-vscode-agent`
3. Install dependencies: `npm install`
4. Build the plugin: `npm run build`
5. Restart Tlink

### Initial Setup

#### Step 1: Configure MCP Server
1. Open Tlink settings
2. Navigate to **Settings → Copilot Agent** (or **MCP** tab)
3. Configure the following:
   - **Port**: Default is `3001` (change if needed)
   - **Start on Boot**: Toggle to automatically start server when Tlink launches
   - **Pair Programming Mode**: Enable for command confirmation before execution

#### Step 2: Start the MCP Server
1. In the Copilot Agent settings, click **Start Server**
2. Verify server is running (status indicator should show "Running")
3. Note the server URL: `http://localhost:3001/sse`

#### Step 3: Configure VS Code
1. Open VS Code settings
2. Navigate to MCP configuration (usually in `~/.config/Code/User/globalStorage/mcp.json` or VS Code settings)
3. Add the following configuration:

**For HTTP/SSE Connection (Recommended):**
```json
{
  "servers": {
    "tlink": {
      "url": "http://localhost:3001/sse",
      "type": "http"
    }
  }
}
```

**For Stdio Connection (Alternative):**
```json
{
  "servers": {
    "tlink-stdio": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-stdio-server>"]
    }
  }
}
```
*Note: The stdio server path can be found in Tlink's Copilot Agent settings*

### Basic Workflow

#### Workflow 1: AI-Powered Command Execution

1. **Open VS Code with MCP Client**
   - Ensure VS Code has an MCP-compatible AI extension installed
   - The AI client should automatically connect to the Tlink MCP server

2. **Request Command Execution**
   - In VS Code chat/AI interface, ask: *"List all my terminal sessions"*
   - The AI will use the `get_ssh_session_list` tool to retrieve sessions

3. **Execute Commands**
   - Ask: *"Run 'ls -la' in the first terminal session"*
   - If Pair Programming Mode is enabled, you'll see a confirmation dialog
   - Approve or reject the command
   - Command executes in the selected terminal

4. **View Results**
   - Command output appears in the terminal
   - Results are also available via `get_command_output` tool
   - Command is saved to history automatically

#### Workflow 2: Terminal Buffer Reading

1. **Request Terminal Content**
   - Ask AI: *"Show me the last 50 lines from terminal session 0"*
   - AI uses `get_terminal_buffer` tool with parameters:
     - `tabId`: 0
     - `startLine`: -50 (negative for lines from end)
     - `endLine`: 0

2. **AI Analyzes Content**
   - AI receives terminal buffer content
   - Can analyze output, suggest next commands, or troubleshoot issues

#### Workflow 3: Command History Management

1. **Access Command History**
   - Click the **Command History** button in Tlink toolbar
   - Or use hotkey (default: configured in settings)

2. **Review Past Commands**
   - Browse executed commands with timestamps
   - View command explanations (if provided)
   - See which terminal session executed each command

3. **View Command Output**
   - Click on any command in history
   - View full output with pagination
   - Copy output if needed

#### Workflow 4: Running Commands Management

1. **Monitor Active Commands**
   - Click **Running Commands** button in toolbar
   - See all currently executing commands

2. **Abort Commands**
   - Select a running command
   - Click **Abort** to send Ctrl+C
   - Command is terminated safely

#### Workflow 5: VS Code Chat Integration

1. **Open VS Code Chat**
   - Click **Open Copilot Chat** button in Tlink toolbar
   - Or ask AI: *"Open VS Code chat"*
   - AI uses `open-vscode-chat` tool

2. **Seamless Integration**
   - Chat opens in VS Code
   - AI can continue controlling terminal from VS Code
   - All tools remain available

### Advanced Usage

#### Pair Programming Mode

**Purpose**: Safety feature that requires user confirmation before AI executes commands

**How it works**:
1. AI requests command execution
2. Confirmation dialog appears in Tlink
3. Dialog shows:
   - Command to be executed
   - Explanation (if provided by AI)
   - Target terminal session
4. User can:
   - **Approve**: Command executes immediately
   - **Reject**: Command is cancelled, feedback sent to AI
   - **Modify**: Edit command before approval

**Best Practices**:
- Enable for production/sensitive environments
- Disable for development/testing when you trust the AI
- Review command explanations carefully

#### Command Output Storage

**Features**:
- All command outputs are automatically stored
- Outputs are paginated for large results
- Accessible via `get_command_output` tool
- Stored with unique output IDs

**Usage**:
```typescript
// AI can request output by ID
{
  "outputId": "cmd-1234567890",
  "startLine": 0,
  "maxLines": 100
}
```

#### SSH Session Management

**Available Information**:
- Session ID
- Session title
- Connection details (user@host)
- Session status (active/inactive)

**Usage Example**:
1. AI asks: *"What terminal sessions do I have?"*
2. AI receives list via `get_ssh_session_list`
3. AI can then target specific sessions for commands

### Tool Reference

#### Available MCP Tools

| Tool Name | Description | Parameters | Example |
|-----------|-------------|------------|---------|
| `get_ssh_session_list` | Get all terminal sessions | None | Returns array of sessions with IDs |
| `exec_command` | Execute command in terminal | `command`, `tabId`, `commandExplanation` | Execute "ls -la" in session 0 |
| `get_terminal_buffer` | Get terminal content | `tabId`, `startLine`, `endLine` | Get last 50 lines from session 0 |
| `get_command_output` | Get stored command output | `outputId`, `startLine`, `maxLines` | Get output with pagination |
| `open-vscode-chat` | Open VS Code chat window | None | Opens Copilot chat in VS Code |

#### Tool Usage Examples

**Example 1: List and Execute**
```json
// Step 1: Get sessions
{
  "tool": "get_ssh_session_list"
}

// Step 2: Execute command
{
  "tool": "exec_command",
  "parameters": {
    "command": "pwd",
    "tabId": 0,
    "commandExplanation": "Check current directory"
  }
}
```

**Example 2: Read Terminal Buffer**
```json
{
  "tool": "get_terminal_buffer",
  "parameters": {
    "tabId": 0,
    "startLine": -100,
    "endLine": 0
  }
}
```

**Example 3: Get Command Output**
```json
{
  "tool": "get_command_output",
  "parameters": {
    "outputId": "cmd-1234567890",
    "startLine": 0,
    "maxLines": 50
  }
}
```

### UI Components Guide

#### Settings Tab
- **Location**: Settings → Copilot Agent
- **Features**:
  - Server port configuration
  - Start/Stop server controls
  - Start on boot toggle
  - Pair Programming Mode toggle
  - Server status indicator
  - Connection instructions

#### Toolbar Buttons
- **Open Copilot Chat**: Opens VS Code chat window
- **Command History**: Shows command history modal
- **Running Commands**: Shows active commands dialog
- **Exec Command**: Quick command execution (if enabled)

#### Dialogs and Modals
- **Confirm Command Dialog**: Appears when Pair Programming Mode is enabled
- **Command Result Dialog**: Shows command execution results
- **Command History Modal**: Browse and review past commands
- **Running Commands Dialog**: Monitor and abort active commands

### Troubleshooting

#### Server Won't Start
1. Check if port is already in use
2. Verify firewall settings
3. Check Tlink logs for errors
4. Try changing the port number

#### VS Code Can't Connect
1. Verify MCP server is running in Tlink
2. Check `mcp.json` configuration in VS Code
3. Verify URL/port matches Tlink settings
4. Check VS Code extension logs

#### Commands Not Executing
1. Verify terminal session exists
2. Check if Pair Programming Mode requires approval
3. Verify command syntax is correct
4. Check terminal session is active

#### Tools Not Available
1. Verify plugin is loaded (check Tlink logs)
2. Restart Tlink
3. Reinstall plugin if needed
4. Check MCP server connection

### Best Practices

1. **Security**
   - Use Pair Programming Mode in production
   - Review commands before approval
   - Limit AI access to sensitive terminals
   - Regularly review command history

2. **Performance**
   - Don't execute too many commands simultaneously
   - Use appropriate buffer line ranges
   - Clear command history periodically
   - Monitor running commands

3. **Workflow**
   - Use descriptive command explanations
   - Organize terminals by purpose
   - Use command history for reference
   - Keep VS Code and Tlink in sync

4. **Integration**
   - Keep MCP server running during work sessions
   - Use VS Code chat for complex workflows
   - Leverage command output storage
   - Utilize SSH session management

### Example Scenarios

#### Scenario 1: Development Workflow
1. Open Tlink with multiple terminal sessions
2. Start MCP server
3. In VS Code, ask AI: *"Set up my development environment"*
4. AI uses tools to:
   - Check current directory
   - Install dependencies
   - Start development servers
   - Verify setup

#### Scenario 2: Debugging Session
1. Error occurs in terminal
2. Ask AI: *"Show me the last 100 lines from terminal 0"*
3. AI retrieves buffer content
4. AI analyzes error and suggests fix
5. AI executes fix command (with approval if enabled)

#### Scenario 3: Multi-Session Management
1. Multiple SSH sessions active
2. Ask AI: *"Run 'git status' in all my git repositories"*
3. AI:
   - Lists all sessions
   - Identifies which are git repos
   - Executes command in each
   - Aggregates results

## Notes

- The plugin uses Angular 15, which should be compatible with Tlink
- MCP SDK version should be checked for compatibility
- Express server setup should work as-is
- Terminal integration should work if APIs are compatible
- Settings integration should work if SettingsTabProvider API is compatible
