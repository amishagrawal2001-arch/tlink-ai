import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent } from '../api/baseTerminalTab.component'
import { TerminalDecorator } from '../api/decorator'
import { LogService, Logger } from 'tlink-core'
import { SessionSharingService } from 'tlink-core'

/**
 * Decorator that enables real-time terminal session sharing
 */
@Injectable()
export class SessionSharingDecorator extends TerminalDecorator {
    private logger: Logger
    private sharedTerminals = new Map<BaseTerminalTabComponent<any>, string>() // Maps terminal to session ID

    constructor (
        log: LogService,
        private sessionSharing: SessionSharingService,
    ) {
        super()
        this.logger = log.create('sessionSharing')
    }

    attach (terminal: BaseTerminalTabComponent<any>): void {
        // Check if terminal is already shared
        if (this.sessionSharing.isSessionShared(terminal)) {
            this.attachToSharedSession(terminal)
        }

        // Note: When shareSession is called on the service, we need to manually attach
        // For now, the decorator will attach when checking. In the future, we could use
        // an observable to detect when sharing starts.
    }

    detach (terminal: BaseTerminalTabComponent<any>): void {
        this.detachFromSharedSession(terminal)
        super.detach(terminal)
    }

    private attachToSharedSession (terminal: BaseTerminalTabComponent<any>): void {
        const sharedSession = this.sessionSharing.getSharedSession(terminal)
        if (!sharedSession || !terminal.session) {
            return
        }

        if (this.sharedTerminals.has(terminal)) {
            return // Already attached
        }

        this.sharedTerminals.set(terminal, sharedSession.id)

        // Subscribe to terminal output and broadcast it
        this.subscribeUntilDetached(terminal, terminal.session.binaryOutput$.subscribe(data => {
            this.sessionSharing.broadcastOutput(sharedSession.id, data)
        }))

        // Subscribe to terminal input for interactive mode
        // Note: Input forwarding would need to be implemented via the frontend
        if (sharedSession.mode === 'interactive') {
            // For now, input forwarding is not implemented
            // Would need to intercept frontend input events
            this.logger.debug('Interactive mode enabled, but input forwarding not yet implemented')
        }

        // Subscribe to session close/destroy to stop sharing
        this.subscribeUntilDetached(terminal, terminal.session.closed$.subscribe(() => {
            void this.sessionSharing.stopSharing(terminal)
        }))

        this.subscribeUntilDetached(terminal, terminal.session.destroyed$.subscribe(() => {
            void this.sessionSharing.stopSharing(terminal)
        }))

        this.logger.info('Session sharing attached to terminal:', sharedSession.id)
    }

    private detachFromSharedSession (terminal: BaseTerminalTabComponent<any>): void {
        if (!this.sharedTerminals.has(terminal)) {
            return
        }

        const sessionId = this.sharedTerminals.get(terminal)!
        this.sharedTerminals.delete(terminal)

        this.logger.info('Session sharing detached from terminal:', sessionId)
    }
}
