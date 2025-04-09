/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient'
import { EditTracker } from './editTracker'
import { EditSuggestionsHandler } from './editSuggestionsHandler'
import { getLogger } from 'aws-core-vscode/shared'
import {
    EditSuggestionsParams,
    editSuggestionsRequestType,
    EditSuggestionsResult,
} from '@aws/language-server-runtimes/protocol'

/**
 * Service for requesting and handling edit suggestions.
 */
export class EditSuggestionService {
    private editTracker: EditTracker
    private editSuggestionsHandler: EditSuggestionsHandler
    private debounceTimer: NodeJS.Timeout | undefined
    private static readonly debounceDelay = 2000 // 2 seconds

    constructor(
        private readonly languageClient: LanguageClient,
        editTracker: EditTracker = new EditTracker(),
        editSuggestionHandler: EditSuggestionsHandler | undefined = undefined
    ) {
        this.editTracker = editTracker
        this.editSuggestionsHandler = editSuggestionHandler || new EditSuggestionsHandler(languageClient)
    }

    /**
     * Registers event handlers for tracking document changes.
     */
    public registerEventHandlers(): vscode.Disposable[] {
        const disposables: vscode.Disposable[] = []

        // Track document changes
        disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document && event.contentChanges.length > 0) {
                    const tracked = this.editTracker.processDocumentEdit(event.document, event)

                    if (tracked) {
                        this.debounceTriggerEditSuggestion(event.document)
                    }
                }
            })
        )

        // Clear tracked edits when document closes
        disposables.push(
            vscode.workspace.onDidCloseTextDocument((document) => {
                this.editTracker.clearEdits(document)
            })
        )

        return disposables
    }

    /**
     * Debounces the trigger for edit suggestions.
     */
    private debounceTriggerEditSuggestion(document: vscode.TextDocument): void {
        // Clear existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
        }

        // Set new timer
        this.debounceTimer = setTimeout(() => {
            void this.requestEditSuggestions(document)
            this.debounceTimer = undefined
        }, EditSuggestionService.debounceDelay)
    }

    /**
     * Requests edit suggestions for a document.
     */
    public async requestEditSuggestions(document: vscode.TextDocument): Promise<void> {
        try {
            const editor = vscode.window.activeTextEditor
            if (!editor || editor.document !== document) {
                return
            }

            // Get recent edits
            const recentEdits = this.editTracker.getRecentEdits(document)
            if (recentEdits.length === 0) {
                return
            }

            // Request edit suggestions
            const params: EditSuggestionsParams = {
                textDocument: {
                    uri: document.uri.toString(),
                },
                position: {
                    line: editor.selection.active.line,
                    character: editor.selection.active.character,
                },
                editHistory: recentEdits,
            }

            const response: EditSuggestionsResult = await this.languageClient.sendRequest(
                editSuggestionsRequestType as any,
                params
            )

            // Process suggestions
            if (response && response.suggestions.length > 0) {
                // Set session ID for telemetry
                this.editSuggestionsHandler.setSessionId(response.sessionId)

                // Show the first suggestion
                await this.editSuggestionsHandler.showEditSuggestion(editor, response.suggestions[0])

                // Send telemetry
                await this.editSuggestionsHandler.sendTelemetry()
            }
        } catch (err) {
            getLogger().error('Failed to get edit suggestions: %O', err)
        }
    }

    /**
     * Disposes resources.
     */
    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
        }
        this.editSuggestionsHandler.dispose()
    }
}
