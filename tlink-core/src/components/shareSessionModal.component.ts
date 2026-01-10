import { Component, Input, ViewChild, ElementRef, Injector } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { PlatformService } from '../api/platform'

/** @hidden */
@Component({
    templateUrl: './shareSessionModal.component.pug',
    styleUrls: ['./shareSessionModal.component.scss'],
})
export class ShareSessionModalComponent {
    @Input() shareUrl: string
    @Input() mode: 'read-only' | 'interactive' = 'read-only'
    @Input() viewers: number = 0
    @Input() expiresIn?: number // minutes
    @ViewChild('urlInput') urlInput: ElementRef
    private platform: PlatformService | null = null

    constructor (
        private modalInstance: NgbActiveModal,
        private injector: Injector,
    ) {
        try {
            this.platform = this.injector.get(PlatformService)
        } catch {
            // Platform service not available
        }
    }

    ngOnInit (): void {
        setTimeout(() => {
            if (this.urlInput) {
                this.urlInput.nativeElement.select()
            }
        })
    }

    async copyUrl (): Promise<void> {
        if (this.shareUrl) {
            // Use platform service if available
            if (this.platform) {
                try {
                    this.platform.setClipboard({ text: this.shareUrl })
                    return
                } catch {
                    // Fallback to execCommand
                }
            }
            // Fallback: Copy to clipboard using execCommand
            if (this.urlInput) {
                this.urlInput.nativeElement.select()
                document.execCommand('copy')
            }
        }
    }

    close (): void {
        this.modalInstance.close()
    }
}
