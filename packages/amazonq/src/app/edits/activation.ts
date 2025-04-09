/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient'
import { EditSuggestionService } from './editSuggestionsService'
import { getLogger } from 'aws-core-vscode/shared'

/**
 * Activates the edit suggestion feature
 */
export function activate(languageClient: LanguageClient, context: vscode.ExtensionContext) {
    try {
        // Create edit suggestion service
        const editSuggestionService = new EditSuggestionService(languageClient)

        // Register event handlers
        const eventHandlers = editSuggestionService.registerEventHandlers()
        context.subscriptions.push(...eventHandlers)

        // Register the service itself for disposal
        context.subscriptions.push(editSuggestionService)

        // Register command to manually trigger edit suggestions
        context.subscriptions.push(
            vscode.commands.registerCommand('amazonq.triggerEditSuggestion', async () => {
                try {
                    const editor = vscode.window.activeTextEditor
                    if (editor) {
                        await editSuggestionService.requestEditSuggestions(editor.document)
                        // TODO Remove the line below, just for coding validation
                        void vscode.window.showInformationMessage('Requesting edit suggestions from Amazon Q...')
                    }
                } catch (err) {
                    getLogger().error('Failed to trigger edit suggestion: %O', err)
                }
            })
        )

        getLogger().info('Edit suggestion feature activated')
    } catch (err) {
        getLogger().error('Failed to activate edit suggestion feature: %O', err)
    }
}
