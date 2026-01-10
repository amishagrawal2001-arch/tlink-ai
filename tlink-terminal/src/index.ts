import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { ToastrModule } from 'ngx-toastr'
import { NgxColorsModule } from 'ngx-colors'

import TlinkCorePlugin, { CommandProvider, ConfigProvider, HotkeyProvider, TabContextMenuItemProvider, CLIHandler, TabRecoveryProvider } from 'tlink-core'
import { SettingsTabProvider } from 'tlink-settings'

import { AppearanceSettingsTabComponent } from './components/appearanceSettingsTab.component'
import { ColorSchemeSettingsTabComponent } from './components/colorSchemeSettingsTab.component'
import { TerminalSettingsTabComponent } from './components/terminalSettingsTab.component'
import { ColorPickerComponent } from './components/colorPicker.component'
import { ColorSchemePreviewComponent } from './components/colorSchemePreview.component'
import { SearchPanelComponent } from './components/searchPanel.component'
import { StreamProcessingSettingsComponent } from './components/streamProcessingSettings.component'
import { LoginScriptsSettingsComponent } from './components/loginScriptsSettings.component'
import { TerminalToolbarComponent } from './components/terminalToolbar.component'
import { ColorSchemeSelectorComponent } from './components/colorSchemeSelector.component'
import { InputProcessingSettingsComponent } from './components/inputProcessingSettings.component'
import { ColorSchemeSettingsForModeComponent } from './components/colorSchemeSettingsForMode.component'
import { CommandWindowTabComponent } from './components/commandWindowTab.component'
import { TerminalButtonBarComponent } from './components/terminalButtonBar.component'
import { MapButtonModalComponent } from './components/mapButtonModal.component'
import { SessionManagerTabComponent } from './components/sessionManagerTab.component'
import { ProfileCreateModalComponent } from './components/profileCreateModal.component'
import { ColorTemplatesPanelComponent } from './components/colorTemplatesPanel.component'

import { TerminalDecorator } from './api/decorator'
import { TerminalContextMenuItemProvider } from './api/contextMenuProvider'
import { TerminalColorSchemeProvider } from './api/colorSchemeProvider'
import { TerminalSettingsTabProvider, AppearanceSettingsTabProvider, ColorSchemeSettingsTabProvider } from './settings'
import { DebugDecorator } from './features/debug'
import { ZModemDecorator } from './features/zmodem'
import { SessionLoggerDecorator } from './features/sessionLogger'
import { SessionSharingDecorator } from './features/sessionSharing'
import { TerminalConfigProvider } from './config'
import { TerminalHotkeyProvider } from './hotkeys'
import { CopyPasteContextMenu, MiscContextMenu, LegacyContextMenu, ReconnectContextMenu, SaveAsProfileContextMenu, SessionSharingContextMenu } from './tabContextMenu'

import { Frontend } from './frontends/frontend'
import { XTermFrontend, XTermWebGLFrontend } from './frontends/xtermFrontend'
import { TerminalCLIHandler } from './cli'
import { DefaultColorSchemes } from './colorSchemes'
import { CommandWindowCommandProvider } from './commandWindowProvider'
import { CommandWindowRecoveryProvider } from './commandWindowRecoveryProvider'
import { ButtonBarCommandProvider } from './buttonBarProvider'
import { SessionManagerCommandProvider } from './sessionManagerProvider'

/** @hidden */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        ToastrModule,
        TlinkCorePlugin,
        NgxColorsModule,
    ],
    providers: [
        { provide: SettingsTabProvider, useClass: AppearanceSettingsTabProvider, multi: true },
        { provide: SettingsTabProvider, useClass: ColorSchemeSettingsTabProvider, multi: true },
        { provide: SettingsTabProvider, useClass: TerminalSettingsTabProvider, multi: true },

        { provide: ConfigProvider, useClass: TerminalConfigProvider, multi: true },
        { provide: HotkeyProvider, useClass: TerminalHotkeyProvider, multi: true },
        { provide: TerminalDecorator, useClass: ZModemDecorator, multi: true },
        { provide: TerminalDecorator, useClass: DebugDecorator, multi: true },
        { provide: TerminalDecorator, useClass: SessionLoggerDecorator, multi: true },
        { provide: TerminalDecorator, useClass: SessionSharingDecorator, multi: true },

        { provide: TabContextMenuItemProvider, useClass: CopyPasteContextMenu, multi: true },
        { provide: TabContextMenuItemProvider, useClass: MiscContextMenu, multi: true },
        { provide: TabContextMenuItemProvider, useClass: LegacyContextMenu, multi: true },
        { provide: TabContextMenuItemProvider, useClass: ReconnectContextMenu, multi: true },
        { provide: TabContextMenuItemProvider, useClass: SaveAsProfileContextMenu, multi: true },
        { provide: TabContextMenuItemProvider, useClass: SessionSharingContextMenu, multi: true },

        { provide: CLIHandler, useClass: TerminalCLIHandler, multi: true },
        { provide: TerminalColorSchemeProvider, useClass: DefaultColorSchemes, multi: true },
        { provide: CommandProvider, useClass: CommandWindowCommandProvider, multi: true },
        { provide: CommandProvider, useClass: ButtonBarCommandProvider, multi: true },
        { provide: CommandProvider, useClass: SessionManagerCommandProvider, multi: true },
        { provide: TabRecoveryProvider, useClass: CommandWindowRecoveryProvider, multi: true },
    ],
    declarations: [
        ColorPickerComponent,
        ColorSchemePreviewComponent,
        ColorSchemeSelectorComponent,
        AppearanceSettingsTabComponent,
        ColorSchemeSettingsTabComponent,
        TerminalSettingsTabComponent,
        SearchPanelComponent,
        StreamProcessingSettingsComponent,
        LoginScriptsSettingsComponent,
        TerminalToolbarComponent,
        InputProcessingSettingsComponent,
        ColorSchemeSettingsForModeComponent,
        CommandWindowTabComponent,
        TerminalButtonBarComponent,
        MapButtonModalComponent,
        SessionManagerTabComponent,
        ProfileCreateModalComponent,
        ColorTemplatesPanelComponent,
    ],
    exports: [
        ColorPickerComponent,
        ColorSchemeSelectorComponent,
        SearchPanelComponent,
        StreamProcessingSettingsComponent,
        LoginScriptsSettingsComponent,
        TerminalToolbarComponent,
        TerminalButtonBarComponent,
        InputProcessingSettingsComponent,
    ],
})
export default class TerminalModule { } // eslint-disable-line @typescript-eslint/no-extraneous-class

export { TerminalDecorator, TerminalContextMenuItemProvider, TerminalColorSchemeProvider }
export { Frontend, XTermFrontend, XTermWebGLFrontend }
export { BaseTerminalTabComponent } from './api/baseTerminalTab.component'
export { ConnectableTerminalTabComponent } from './api/connectableTerminalTab.component'
export * from './api/interfaces'
export * from './middleware/streamProcessing'
export * from './middleware/loginScriptProcessing'
export * from './middleware/oscProcessing'
export * from './middleware/utf8Splitter'
export * from './middleware/inputProcessing'
export * from './api/middleware'
export * from './session'
export { LoginScriptsSettingsComponent, StreamProcessingSettingsComponent }
export { MultifocusService } from './services/multifocus.service'
