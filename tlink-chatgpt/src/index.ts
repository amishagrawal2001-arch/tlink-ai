/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { CommonModule } from '@angular/common'
import { NgModule, Injectable } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TlinkCorePlugin, { AppService, Command, CommandProvider, ConfigProvider, ProfileProvider, SplitTabComponent } from 'tlink-core'

import { ChatTabComponent } from './components/chatTab.component'
import { ChatGPTConfigProvider } from './config'
import { ChatGPTProfilesService } from './profiles'

@Injectable()
export class ChatGPTCommandProvider extends CommandProvider {
    constructor (
        private app: AppService,
    ) {
        super()
    }

    async provide (): Promise<Command[]> {
        return [
            {
                id: 'tlink-chatgpt:open',
                label: 'AI Chat',
                icon: '<i class="fas fa-comments"></i>',
                run: async () => this.openChatTab(),
            },
        ]
    }

    private openChatTab (): void {
        const existing = this.findChatTab()
        if (existing) {
            const parent = this.app.getParentTab(existing)
            if (parent) {
                parent.focus(existing)
                this.app.selectTab(parent)
            } else {
                this.app.selectTab(existing)
            }
            return
        }

        this.app.openNewTabRaw({ type: ChatTabComponent })
    }

    private findChatTab (): ChatTabComponent | null {
        for (const tab of this.app.tabs) {
            if (tab instanceof ChatTabComponent) {
                return tab
            }
            if (tab instanceof SplitTabComponent) {
                const nested = tab.getAllTabs().find(t => t instanceof ChatTabComponent) as ChatTabComponent | undefined
                if (nested) {
                    return nested
                }
            }
        }
        return null
    }
}

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        TlinkCorePlugin,
    ],
    providers: [
        { provide: CommandProvider, useClass: ChatGPTCommandProvider, multi: true },
        { provide: ConfigProvider, useClass: ChatGPTConfigProvider, multi: true },
        { provide: ProfileProvider, useExisting: ChatGPTProfilesService, multi: true },
    ],
    declarations: [
        ChatTabComponent,
    ],
})
export default class ChatGPTModule { }

export { ChatTabComponent }
