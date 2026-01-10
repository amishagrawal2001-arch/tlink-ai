import { app, ipcMain, Menu, dialog, nativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as nodeModule from 'module'

// set userData Path on portable version
import './portable'

const packagedNodeModules = app.isPackaged ? path.join(process.resourcesPath, 'node_modules') : null
if (packagedNodeModules && fs.existsSync(packagedNodeModules)) {
    const nodePathEntries = (process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []).filter(Boolean)
    if (!nodePathEntries.includes(packagedNodeModules)) {
        nodePathEntries.push(packagedNodeModules)
        process.env.NODE_PATH = nodePathEntries.join(path.delimiter)
        ;(nodeModule as any)._initPaths()
    }
}

require('dotenv/config')

// set defaults of environment variables

const bundledCAFile = app.isPackaged
    ? path.join(process.resourcesPath, 'certs', 'corp-root.pem')
    : path.join(app.getAppPath(), '..', 'build', 'certs', 'corp-root.pem')
const extraCAFile = process.env.TLINK_NPM_CAFILE
const resolvedExtraCAFile = extraCAFile && fs.existsSync(extraCAFile) ? extraCAFile : undefined
const resolvedCAFile = resolvedExtraCAFile ?? (fs.existsSync(bundledCAFile) ? bundledCAFile : undefined)
if (resolvedCAFile && !process.env.NODE_EXTRA_CA_CERTS) {
    process.env.NODE_EXTRA_CA_CERTS = resolvedCAFile
}
if (resolvedCAFile && !process.env.NPM_CONFIG_CAFILE) {
    process.env.NPM_CONFIG_CAFILE = resolvedCAFile
}
const npmRegistry = process.env.TLINK_NPM_REGISTRY
if (npmRegistry && !process.env.NPM_CONFIG_REGISTRY) {
    process.env.NPM_CONFIG_REGISTRY = npmRegistry
}
const npmStrictSSL = process.env.TLINK_NPM_STRICT_SSL
if (npmStrictSSL && !process.env.NPM_CONFIG_STRICT_SSL) {
    process.env.NPM_CONFIG_STRICT_SSL = npmStrictSSL
}

const appName = 'Tlink'
app.setName(appName)
if (process.platform === 'darwin') {
    app.setAboutPanelOptions({ applicationName: appName })
}

process.env.TLINK_PLUGINS ??= ''
process.env.TLINK_CONFIG_DIRECTORY ??= app.getPath('userData')

require('v8-compile-cache')
require('source-map-support/register')
require('./sentry')
require('./lru')

// Silence a noisy deprecation warning from electron-debug on newer Electron:
// "session.getAllExtensions is deprecated" (moved to session.extensions.getAllExtensions)
process.on('warning', warning => {
    if (warning?.name === 'DeprecationWarning' && String(warning?.message ?? '').includes('session.getAllExtensions')) {
        return
    }
    // Re-emit other warnings as usual
    console.warn(warning)
})

const { ensureBundledOllama } = require('./ollama')

const { parseArgs } = require('./cli')
const { Application } = require('./app')
const electronDebug = require('electron-debug')
const { loadConfig } = require('./config')



const argv = parseArgs(process.argv, process.cwd())

// eslint-disable-next-line @typescript-eslint/init-declarations
let configStore: any

try {
    configStore = loadConfig()
} catch (err) {
    dialog.showErrorBox('Could not read config', err.message)
    app.exit(1)
}

process.mainModule = module

const application = new Application(configStore)

ipcMain.on('app:new-window', () => {
    application.newWindow()
})

process.on('uncaughtException' as any, err => {
    console.log(err)
    application.broadcast('uncaughtException', err)
})

if (argv.d) {
    electronDebug({
        isEnabled: true,
        showDevTools: true,
        devToolsMode: 'undocked',
    })
}

app.on('activate', async () => {
    if (!application.hasWindows()) {
        application.newWindow()
    } else {
        application.focus()
    }
})

app.on('second-instance', async (_event, newArgv, cwd) => {
    application.handleSecondInstance(newArgv, cwd)
})

if (!app.requestSingleInstanceLock()) {
    app.quit()
    app.exit(0)
}

app.on('ready', async () => {
    ensureBundledOllama()

    if (process.platform === 'darwin') {
        const dockIconPath = path.join(app.getAppPath(), '..', 'build', 'icons', 'Tlink-logo.png')
        const dockIcon = nativeImage.createFromPath(dockIconPath)
        if (!dockIcon.isEmpty()) {
            app.dock.setIcon(dockIcon)
        }
        app.dock.setMenu(Menu.buildFromTemplate([
            {
                label: 'New window',
                click () {
                    this.app.newWindow()
                },
            },
        ]))
    }

    await application.init()

    const window = await application.newWindow({ hidden: argv.hidden })
    await window.ready
    window.passCliArguments(process.argv, process.cwd(), false)
    window.focus()
})
