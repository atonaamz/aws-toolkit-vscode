/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'

/**
 * Manages decorations for edit suggestions
 */
export class EditDecorationManager implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType
    private acceptHandler?: () => void
    private rejectHandler?: () => void
    private disposables: vscode.Disposable[] = []

    constructor() {
        // Create decoration type for edit suggestions
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 10px',
                height: '100%',
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        })

        // Register commands for accepting/rejecting suggestions
        this.disposables.push(
            vscode.commands.registerCommand('amazonq.acceptEditSuggestion', () => {
                if (this.acceptHandler) {
                    this.acceptHandler()
                }
            }),
            vscode.commands.registerCommand('amazonq.rejectEditSuggestion', () => {
                if (this.rejectHandler) {
                    this.rejectHandler()
                }
            })
        )

        // Handle Tab and Escape keys
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(() => {
                // Clear decorations when selection changes
                if (this.isDecorationVisible()) {
                    this.clearDecorations()
                }
            })
        )
    }

    /**
     * Displays an edit suggestion as a decoration
     */
    public displayEditSuggestion(
        editor: vscode.TextEditor,
        svgUri: vscode.Uri,
        range: vscode.Range,
        acceptHandler: () => void,
        rejectHandler: () => void
    ): void {
        // Store handlers
        this.acceptHandler = acceptHandler
        this.rejectHandler = rejectHandler

        // Create decoration options
        const decorationOptions: vscode.DecorationOptions[] = [
            {
                range,
                renderOptions: {
                    after: {
                        contentIconPath: svgUri,
                        width: '500px',
                        height: 'auto',
                    },
                },
            },
        ]

        // Apply decoration
        editor.setDecorations(this.decorationType, decorationOptions)

        // Show action buttons
        void vscode.window
            .showInformationMessage('Amazon Q suggests an edit. Would you like to apply it?', 'Accept', 'Reject')
            .then((selection) => {
                if (selection === 'Accept') {
                    this.acceptHandler?.()
                } else if (selection === 'Reject') {
                    this.rejectHandler?.()
                } else {
                    // User dismissed the message
                    this.clearDecorations(editor)
                }
            })

        // Register keyboard shortcuts for this suggestion
        this.registerTemporaryKeyboardShortcuts()
    }

    /**
     * Clears decorations from the editor
     */
    public clearDecorations(editor?: vscode.TextEditor): void {
        if (editor) {
            editor.setDecorations(this.decorationType, [])
        } else {
            // Clear from all editors
            for (const e of vscode.window.visibleTextEditors) {
                e.setDecorations(this.decorationType, [])
            }
        }

        // Clear handlers
        this.acceptHandler = undefined
        this.rejectHandler = undefined

        // Unregister temporary keyboard shortcuts
        this.unregisterTemporaryKeyboardShortcuts()
    }

    /**
     * Checks if a decoration is currently visible
     */
    private isDecorationVisible(): boolean {
        return this.acceptHandler !== undefined || this.rejectHandler !== undefined
    }

    /**
     * Registers temporary keyboard shortcuts for accepting/rejecting suggestions
     */
    private registerTemporaryKeyboardShortcuts(): void {
        // Register Tab key for accepting
        const tabDisposable = vscode.commands.registerCommand('amazonq.edits.decorationManager.accept', (args) => {
            if (args.text === '\t' && this.isDecorationVisible() && this.acceptHandler) {
                this.acceptHandler()
                return undefined // Prevent default Tab behavior
            }
            return args // Allow default behavior
        })

        // Register Escape key for rejecting
        const escDisposable = vscode.commands.registerCommand('amazonq.edits.decorationManager.reject', () => {
            if (this.isDecorationVisible() && this.rejectHandler) {
                this.rejectHandler()
                return undefined // Prevent default Escape behavior
            }
            return undefined // Allow default behavior
        })

        this.disposables.push(tabDisposable, escDisposable)
    }

    /**
     * Unregisters temporary keyboard shortcuts
     */
    private unregisterTemporaryKeyboardShortcuts(): void {
        // The shortcuts are in the disposables array and will be disposed when needed
    }

    /**
     * Disposes resources
     */
    public dispose(): void {
        this.decorationType.dispose()
        for (const d of this.disposables) {
            d.dispose()
        }
        this.disposables = []
    }
}
