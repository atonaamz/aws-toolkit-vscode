/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { EditDecorationManager } from './decorationManager'
import { LanguageClient } from 'vscode-languageclient'
import { getLogger } from 'aws-core-vscode/shared'
import { EditSuggestion, LogEditSuggestionsParams } from '@aws/language-server-runtimes/protocol'

/**
 * Handles displaying and managing edit suggestions.
 */
export class EditSuggestionsHandler {
    private decorationManager: EditDecorationManager
    private sessionId: string | undefined
    private suggestionResults: Record<string, { seen: boolean; accepted: boolean; rejected: boolean }>
    private displayStartTime: number | undefined

    constructor(
        private readonly languageClient: LanguageClient,
        decorationManager: EditDecorationManager = new EditDecorationManager()
    ) {
        this.decorationManager = decorationManager
        this.suggestionResults = {}
    }

    /**
     * Handles displaying an edit suggestion.
     */
    public async showEditSuggestion(editor: vscode.TextEditor, suggestion: EditSuggestion): Promise<boolean> {
        const { itemId, range, newText, svgImage } = suggestion

        // Convert VS Code range
        const vsCodeRange = new vscode.Range(
            range.start.line,
            range.start.character,
            range.end.line,
            range.end.character
        )

        // Check if we have an SVG image from the server
        if (!svgImage) {
            getLogger().error('Edit suggestion is missing SVG image')
            return false
        }

        // Create URI from base64 encoded SVG
        const svgUri = vscode.Uri.parse(`data:image/svg+xml;base64,${svgImage}`)

        // Mark suggestion as seen
        this.suggestionResults[itemId] = {
            seen: true,
            accepted: false,
            rejected: false,
        }

        // Record display start time if this is the first suggestion
        if (this.displayStartTime === undefined) {
            this.displayStartTime = Date.now()
        }

        // Create promise to track user decision
        return new Promise<boolean>((resolve) => {
            // Display decoration with accept/reject handlers
            this.decorationManager.displayEditSuggestion(
                editor,
                svgUri,
                vsCodeRange,
                // Accept handler
                () => {
                    this.applyEdit(editor, vsCodeRange, newText)
                    this.decorationManager.clearDecorations(editor)
                    this.suggestionResults[itemId].accepted = true
                    resolve(true)
                },
                // Reject handler
                () => {
                    this.decorationManager.clearDecorations(editor)
                    this.suggestionResults[itemId].rejected = true
                    resolve(false)
                }
            )
        })
    }

    /**
     * Applies an edit to the document.
     */
    private applyEdit(editor: vscode.TextEditor, range: vscode.Range, newText: string): void {
        const edit = new vscode.WorkspaceEdit()
        edit.replace(editor.document.uri, range, newText)
        void vscode.workspace.applyEdit(edit)
    }

    /**
     * Sets the session ID for the current suggestions.
     */
    public setSessionId(sessionId: string): void {
        this.sessionId = sessionId
        this.suggestionResults = {}
        this.displayStartTime = undefined
    }

    /**
     * Sends telemetry about suggestion results.
     */
    public async sendTelemetry(): Promise<void> {
        if (!this.sessionId || Object.keys(this.suggestionResults).length === 0) {
            return
        }

        try {
            const params: LogEditSuggestionsParams = {
                sessionId: this.sessionId,
                suggestionResults: this.suggestionResults,
            }

            // Add timing information if available
            if (this.displayStartTime !== undefined) {
                params.displayLatency = Date.now() - this.displayStartTime
                params.totalDisplayTime = Date.now() - this.displayStartTime
            }

            // Send telemetry to language server
            this.languageClient.sendNotification('aws/textDocument/logEditSuggestionResults', params)
        } catch (err) {
            getLogger().error('Failed to send edit suggestion telemetry: %O', err)
        }
    }

    /**
     * Disposes resources.
     */
    public dispose(): void {
        this.decorationManager.dispose()
    }
}
