# Tlink AI

<p align="center">
  <strong>AI-Enhanced Terminal Emulator with Integrated Code Editor</strong>
</p>

<p align="center">
  <a href="https://github.com/amishagrawal2001-arch/tlink-ai"><img alt="GitHub" src="https://img.shields.io/github/stars/amishagrawal2001-arch/tlink-ai?style=for-the-badge&logo=github"></a> &nbsp; <a href="https://github.com/amishagrawal2001-arch/tlink-ai/issues"><img alt="GitHub Issues" src="https://img.shields.io/github/issues/amishagrawal2001-arch/tlink-ai?style=for-the-badge&logo=github"></a> &nbsp; <a href="https://github.com/amishagrawal2001-arch/tlink-ai/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/amishagrawal2001-arch/tlink-ai?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://ko-fi.com/J3J8KWTF">
    <img src="https://cdn.ko-fi.com/cdn/kofi3.png?v=2" width="150">
  </a>
</p>

---

> 👋 Managing remote environments? Check out [Warpgate, my smart SSH/HTTP/MySQL bastion server](https://github.com/warp-tech/warpgate), it works great with Tlink AI, you'll love it.

----

### About Tlink AI

Tlink AI is a fork of [Tlink](https://tlink.sh) with enhanced AI capabilities, integrated code editor, and business-focused features. See [BUSINESS_ENHANCEMENTS.md](./BUSINESS_ENHANCEMENTS.md) for detailed enhancement plans.

### Key Features

* **AI-Powered Terminal Assistant** - Context-aware command suggestions and automated troubleshooting
* **Integrated Code Editor** - Monaco-based editor with directory explorer, file management, and run-in-terminal capabilities
* **Real-Time Session Sharing** - Share terminal sessions with team members via WebSocket (read-only or interactive modes)
* **Workspace Management** - Save and restore workspaces, share via URL, team collaboration features
* **Backup & Restore** - Automatic and manual local backups of configuration, workspaces, and profiles
* **Enhanced Collaboration** - Real-time terminal sharing, workspace templates, and team workspaces
* **All Original Tlink Features** - SSH, serial terminal, theming, split panes, and more

<br/>
<p align="center">
This README is also available in: <a  href="./README.es-ES.md">:es: Spanish</a> · <a  href="./README.ru-RU.md">:ru: Русский</a> · <a  href="./README.ko-KR.md">:kr: 한국어</a> · <a  href="./README.zh-CN.md">:cn: 简体中文</a> · <a  href="./README.it-IT.md">:it: Italiano</a> · <a href="./README.de-DE.md">:de: Deutsch</a> · <a href="./README.ja-JP.md">:jp: 日本語</a> · <a href="./README.id-ID.md">:id: Bahasa Indonesia</a> · <a href="./README.pt-BR.md">:brazil: Português</a> · <a href="./README.pl-PL.md">:poland: Polski</a>
</p>

----

[**Tlink AI**](https://github.com/amishagrawal2001-arch/tlink-ai) is an enhanced version of Tlink with AI-powered features, integrated code editor, and advanced terminal capabilities for Windows 10, macOS and Linux

* Integrated SSH and Telnet client and connection manager
* Integrated serial terminal
* **Real-time terminal session sharing** with embedded WebSocket server
* **Workspace management** - Save, load, and share workspace configurations
* **Backup & Restore** - Automatic and manual local backups with integrity verification
* Theming and color schemes
* Fully configurable shortcuts and multi-chord shortcuts
* Split panes
* Remembers your tabs
* PowerShell (and PS Core), WSL, Git-Bash, Cygwin, MSYS2, Cmder and CMD support
* Direct file transfer from/to SSH sessions via Zmodem
* Full Unicode support including double-width characters
* Doesn't choke on fast-flowing outputs
* Proper shell experience on Windows including tab completion (via Clink)
* Integrated encrypted container for SSH secrets and configuration
* SSH, SFTP and Telnet client available as a [web app](https://tlink.sh/app) (also [self-hosted](https://github.com/Eugeny/tlink-web)).

# Contents <!-- omit in toc -->

- [About Tlink AI](#about-tlink-ai)
- [Key Features](#key-features)
- [What Tlink AI is and isn't](#what-tlink-ai-is-and-isnt)
- [Terminal features](#terminal-features)
- [SSH Client](#ssh-client)
- [Serial Terminal](#serial-terminal)
- [Code Editor](#code-editor)
- [Session Sharing](#session-sharing)
- [Workspace Management](#workspace-management)
- [Backup & Restore](#backup--restore)
- [AI Integration](#ai-integration)
- [Portable](#portable)
- [Plugins](#plugins)
- [Themes](#themes)
- [Business Enhancements](#business-enhancements)
- [Contributing](#contributing)

<a name="about"></a>

# What Tlink AI is and isn't

* **Tlink AI is** an enhanced terminal emulator with AI integration, code editing capabilities, and advanced features - an alternative to Windows' standard terminal (conhost), PowerShell ISE, PuTTY, macOS Terminal.app and iTerm

* **Tlink AI is not** a new shell or a MinGW or Cygwin replacement. Neither is it lightweight - if RAM usage is of importance, consider [Conemu](https://conemu.github.io) or [Alacritty](https://github.com/jwilm/alacritty)

<a name="terminal"></a>

# Terminal features

![](docs/readme-terminal.png)

* A VT220 terminal + various extensions
* Multiple nested split panes
* Tabs on any side of the window
* Optional dockable window with a global spawn hotkey ("Quake console")
* Progress detection
* Notification on process completion
* Bracketed paste, multiline paste warnings
* Font ligatures
* Custom shell profiles
* Optional RMB paste and copy-on select (PuTTY style)

<a name="ssh"></a>

# SSH Client

![](docs/readme-ssh.png)

* SSH2 client with a connection manager
* X11 and port forwarding
* Automatic jump host management
* Agent forwarding (incl. Pageant and Windows native OpenSSH Agent)
* Login scripts

<a name="serial"></a>

# Serial Terminal

* Saved connections
* Readline input support
* Optional hex byte-by-byte input and hexdump output
* Newline conversion
* Automatic reconnection

<a name="session-sharing"></a>

# Session Sharing

Real-time terminal session sharing capabilities for team collaboration and remote assistance.

## Features

* **Embedded WebSocket Server** - Built-in server for local network and internet sharing
* **Dual Sharing Modes**:
  - **Read-only mode** - Viewers can observe terminal output in real-time
  - **Interactive mode** - Viewers can send input (useful for pair programming and support)
* **Easy Access Control** - Password protection and expiration options
* **Network Access**:
  - **Local Network** - Automatically accessible on your LAN/Wi-Fi network
  - **Internet Access** - Configure port forwarding or use tunneling services (ngrok, localtunnel)
* **One-Click Control** - Start/stop server via dock button (left sidebar)
* **Smart Prompts** - Automatic prompts to start server when sharing sessions

## Quick Start

1. **Start the WebSocket Server**:
   - Click the plug/power icon in the left dock (below AI Chat button)
   - Server auto-assigns an available port
   - Status indicator shows server state (plug icon = stopped, power icon = running)

2. **Share a Terminal Session**:
   - Right-click any terminal tab
   - Select "Share session"
   - Choose mode: "Read-only" or "Interactive"
   - Optional: Set password and expiration time
   - Copy the shareable URL and send to collaborators

3. **Access Shared Sessions**:
   - **Local Network**: `ws://<your-ip>:<port>/session?sessionId=...&token=...`
   - **Internet**: Configure port forwarding or use tunneling service
   - Viewers connect via WebSocket URL to see real-time terminal output

## Configuration

Edit `~/.config/tlink/config.yaml`:

```yaml
sessionSharing:
  autoStart: false        # Auto-start server on app launch (default: false)
  bindHost: "0.0.0.0"     # Bind to all interfaces (0.0.0.0) or localhost (127.0.0.1)
  port: 0                 # Auto-assign port (0) or specific port number
  enableTunneling: false  # Enable tunneling service integration (future)
```

## Network Access Guide

See [SESSION_SHARING_NETWORK_ACCESS.md](./SESSION_SHARING_NETWORK_ACCESS.md) for detailed guides on:
- Local network sharing (works out of the box)
- Internet access via port forwarding
- Using tunneling services (ngrok, localtunnel, Cloudflare Tunnel)
- Security best practices
- Troubleshooting network connectivity

## Use Cases

* **Team Collaboration** - Share terminal sessions for pair programming and debugging
* **Remote Support** - Help team members troubleshoot issues in real-time
* **Training & Demos** - Conduct live terminal demonstrations
* **Code Reviews** - Review command-line workflows interactively
* **Documentation** - Record and share terminal sessions for tutorials

<a name="workspace"></a>

# Workspace Management

Manage and share your Tlink environment configurations with workspace features.

## Features

* **Save Current Workspace** - Capture current tabs, code editor folders, profiles, and layout
* **Workspace Sharing**:
  - **Export as JSON** - Copy workspace configuration to clipboard
  - **Import from URL** - Load workspace from shared URL
  - **Shareable Links** - Generate URLs for easy workspace distribution
* **Team Workspaces** - Shared team configurations (coming soon)

## Usage

1. **Save Workspace**:
   - Go to Settings → Workspaces
   - Click "Save Current Workspace"
   - Name your workspace
   - Workspace captures all open tabs, code editor state, and layout

2. **Share Workspace**:
   - Select a workspace from the list
   - Click "Share" to generate a shareable URL
   - Or click "Export" to copy JSON configuration
   - Share URL/JSON with team members

3. **Load Workspace**:
   - Click "Load" on any saved workspace
   - Or use "Import from URL" to load from shared link
   - All tabs and configuration restore automatically

<a name="backup-restore"></a>

# Backup & Restore

Automatic and manual local backup system for configuration, workspaces, and profiles.

## Features

* **Automatic Backups** - Schedule periodic backups of your configuration, workspaces, and profiles
* **Manual Backups** - Create backups on-demand at any time
* **Selective Backup** - Choose what to include: configuration, workspaces, profiles
* **Safety Backups** - Automatic safety backup created before restore operations
* **Backup Management** - View, export, import, and delete backups
* **Integrity Verification** - SHA-256 checksums ensure backup integrity
* **Retention Policy** - Automatic cleanup of old backups based on retention period

## Quick Start

1. **Enable Automatic Backups**:
   - Go to Settings → Backup & Restore
   - Enable "Enable automatic backups"
   - Set backup interval (default: 60 minutes)
   - Set retention period (default: 30 days)
   - Choose what to include (config, workspaces, profiles)

2. **Create Manual Backup**:
   - Go to Settings → Backup & Restore
   - Click "Create Backup Now"
   - Backup is created immediately and saved to local backup directory

3. **Restore from Backup**:
   - Go to Settings → Backup & Restore
   - Select a backup from the list
   - Click "Restore" button
   - Confirm restore (a safety backup is automatically created before restore)
   - Restart the app for changes to take effect

4. **Export/Import Backup**:
   - **Export**: Select a backup and click "Export" to save to a file
   - **Import**: Click "Import Backup" to load a backup from a file
   - Useful for transferring backups between systems

## Configuration

Edit `~/.config/tlink/config.yaml`:

```yaml
backup:
  enabled: false              # Enable/disable automatic backups
  interval: 60                # Backup interval in minutes (default: 60)
  retention: 30               # Retention period in days (default: 30)
  includeWorkspaces: true     # Include workspaces in backups
  includeConfig: true         # Include configuration in backups
  includeProfiles: true       # Include profiles in backups
```

## Backup Location

Backups are stored locally in:
- **Linux/macOS**: `~/.config/tlink/backups/`
- **Windows**: `%APPDATA%\tlink\backups\`

Each backup is a JSON file named with timestamp and backup ID for easy identification.

## Backup Contents

Each backup includes:
- **Metadata**: Backup ID, timestamp, checksum, version, device ID
- **Configuration**: Application settings, themes, shortcuts (if enabled)
- **Workspaces**: Saved workspace configurations (if enabled)
- **Profiles**: SSH profiles, terminal profiles, and connection settings (if enabled)

## Safety Features

* **Safety Backup on Restore**: Before any restore operation, a safety backup is automatically created to allow rollback
* **Integrity Checks**: SHA-256 checksums verify backup integrity during restore
* **Error Handling**: Graceful error handling with detailed logging
* **Automatic Cleanup**: Old backups are automatically deleted based on retention policy

## Use Cases

* **Configuration Backup**: Protect your carefully configured settings, profiles, and workspaces
* **Migration**: Transfer your configuration between systems
* **Disaster Recovery**: Restore your configuration after system failures or reinstalls
* **Experimentation**: Try new configurations with the ability to roll back
* **Team Sharing**: Share backup files with team members for consistent setups

<a name="portable"></a>

# Portable

Tlink AI will run as a portable app on Windows, if you create a `data` folder in the same location where `Tlink.exe` lives.

<a name="plugins"></a>

# Plugins

Plugins and themes can be installed directly from the Settings view inside Tlink AI.

* [docker](https://github.com/Eugeny/tlink-docker) - connect to Docker containers
* [title-control](https://github.com/kbjr/terminus-title-control) - allows modifying the title of the terminal tabs by providing a prefix, suffix, and/or strings to be removed
* [quick-cmds](https://github.com/Domain/terminus-quick-cmds) - quickly send commands to one or all terminal tabs
* [save-output](https://github.com/Eugeny/tlink-save-output) - record terminal output into a file
* [sync-config](https://github.com/starxg/terminus-sync-config) - sync the config to Gist or Gitee
* [clippy](https://github.com/Eugeny/tlink-clippy) - an example plugin which annoys you all the time
* [workspace-manager](https://github.com/composer404/tlink-workspace-manager) - allows creating custom workspace profiles based on the given config
* [search-in-browser](https://github.com/composer404/tlink-search-in-browser) - opens default system browser with a text selected from the Tlink's tab
* [sftp-tab](https://github.com/wljince007/tlink-sftp-tab) - open sftp tab for ssh connection like SecureCRT
* [background](https://github.com/moemoechu/tlink-background) - change Tlink background image and more...
* [highlight](https://github.com/moemoechu/tlink-highlight) - Tlink terminal keyword highlight plugin
* [web-auth-handler](https://github.com/Jazzmoon/tlink-web-auth-handler) - In-app web authentication popups (Built primarily for warpgate in-browser auth)
* [mcp-server](https://github.com/thuanpham582002/tlink-mcp-server) - Powerful Model Context Protocol server integration for Tlink that seamlessly connects with AI assistants through MCP clients like Cursor and Windsurf, enhancing your terminal workflow with intelligent AI capabilities.

<a name="themes"></a>

# Themes

* [hype](https://github.com/Eugeny/tlink-theme-hype) - a Hyper inspired theme
* [relaxed](https://github.com/Relaxed-Theme/relaxed-terminal-themes#terminus) - the Relaxed theme for Tlink
* [gruvbox](https://github.com/porkloin/terminus-theme-gruvbox)
* [windows10](https://www.npmjs.com/package/terminus-theme-windows10)
* [altair](https://github.com/yxuko/terminus-altair)
* [catppuccin](https://github.com/catppuccin/tlink) - Soothing pastel theme for Tlink
* [noctis](https://github.com/aaronhuggins/tlink-colors-noctis) - color themes inspired by Noctis VS Code theme

# Sponsors <!-- omit in toc -->

<a href="https://packagecloud.io"><img src="https://assets-production.packagecloud.io/assets/logo_v1-d5895e7b89b2dee19030e85515fd0f91d8f3b37c82d218a6531fc89c2b1b613c.png" width="200"></a>

[**packagecloud**](https://packagecloud.io) has provided free Debian/RPM repository hosting

[![](https://user-images.githubusercontent.com/161476/200423885-7aba2202-fea7-4409-95b9-3a062ce902c7.png)](https://keygen.sh/?via=eugene)

[**keygen**](https://keygen.sh/?via=eugene) has provided free release & auto-update hosting

<a href="https://iqhive.com/"><img src="https://iqhive.com/img/icons/logo.svg" width="200"></a>

[**IQ Hive**](https://iqhive.com) is providing financial support for the project development


<a name="contributing"></a>
# Contributing

Pull requests and plugins are welcome!

See [HACKING.md](./HACKING.md) and [API docs](https://docs.tlink.sh/) for information of how the project is laid out, and a very brief plugin development tutorial.

## Business Enhancements

Tlink AI includes a comprehensive roadmap for business-focused enhancements. See [BUSINESS_ENHANCEMENTS.md](./BUSINESS_ENHANCEMENTS.md) for detailed plans including:

- ✅ **Real-time session sharing** - Implemented! Share terminal sessions with team members via WebSocket
- ✅ **Workspace management** - Implemented! Save, load, and share workspace configurations
- ✅ **Local backup & restore** - Implemented! Automatic and manual backups of configuration, workspaces, and profiles
- Cloud sync and multi-device sync (planned)
- Enhanced AI integration
- Enterprise security features
- CI/CD integration
- Marketplace ecosystem
- And much more!

---
<a name="contributors"></a>

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="http://www.russellmyers.com"><img src="https://avatars2.githubusercontent.com/u/184085?v=4?s=100" width="100px;" alt="Russell Myers"/><br /><sub><b>Russell Myers</b></sub></a><br /><a href="https://github.com/Eugeny/tlink/commits?author=mezner" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://www.morwire.com"><img src="https://avatars1.githubusercontent.com/u/3991658?v=4?s=100" width="100px;" alt="Austin Warren"/><br /><sub><b>Austin Warren</b></sub></a><br /><a href="https://github.com/Eugeny/tlink/commits?author=ehwarren" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Drachenkaetzchen"><img src="https://avatars1.githubusercontent.com/u/162974?v=4?s=100" width="100px;" alt="Felicia Hummel"/><br /><sub><b>Felicia Hummel</b></sub></a><br /><a href="https://github.com/Eugeny/tlink/commits?author=Drachenkaetzchen" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/mikemaccana"><img src="https://avatars2.githubusercontent.com/u/172594?v=4?s=100" width="100px;" alt="Mike MacCana"/><br /><sub><b>Mike MacCana</b></sub></a><br /><a href="https://github.com/Eugeny/tlink/commits?author=mikemaccana" title="Tests">⚠️</a> <a href="#design-mikemaccana" title="Design">🎨</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/yxuko"><img src="https://avatars1.githubusercontent.com/u/1786317?v=4?s=100" width="100px;" alt="Yacine Kanzari"/><br /><sub><b>Yacine Kanzari</b></sub></a><br /><a href="https://github.com/Eugeny/tlink/commits?author=yxuko" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/BBJip"><img src="https://avatars2.githubusercontent.com/u/32908927?v=4?s=100" width="100px;" alt="BBJip"/><br /><sub><b>BBJip</b></sub></a><br /><a href="https://github.com/Eugeny/tlink/commits?author=BBJip" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Futagirl"><img src="https://avatars2.githubusercontent.com/u/33533958?v=4?s=100" width="100px;" alt="Futagirl"/><br /><sub><b>Futagirl</b></sub></a><br /><a href="#design-Futagirl" title="Design">🎨</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome!
