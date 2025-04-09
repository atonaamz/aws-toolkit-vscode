/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { DocumentEdit } from '@aws/language-server-runtimes/protocol'
import * as vscode from 'vscode'

/**
 * Tracks edits made to documents for use in edit prediction.
 */
export class EditTracker {
    private fileEdits: Map<string, DocumentEdit[]>
    private static readonly maxAgeMs = 30_000 // Keep edits for 30 seconds

    constructor() {
        this.fileEdits = new Map<string, DocumentEdit[]>()
    }

    /**
     * Process a document edit event and store relevant information.
     * @returns true if the edit was tracked, false otherwise
     */
    public processDocumentEdit(document: vscode.TextDocument, event: vscode.TextDocumentChangeEvent): boolean {
        const uri = document.uri.toString()
        const currentTime = Date.now()
        const edits = this.fileEdits.get(uri) || []

        // Process and store the edit
        if (this.shouldTrackEdit(event)) {
            this.addNewEdit(uri, currentTime, document, event, edits)
            return true
        }

        return false
    }

    /**
     * Get recent edits for a document.
     */
    public getRecentEdits(document: vscode.TextDocument): DocumentEdit[] {
        const uri = document.uri.toString()
        return [...(this.fileEdits.get(uri) || [])]
    }

    /**
     * Clear tracked edits for a document.
     */
    public clearEdits(document: vscode.TextDocument): void {
        const uri = document.uri.toString()
        this.fileEdits.delete(uri)
    }

    /**
     * Determine if an edit should be tracked.
     * Ignore very small edits or auto-formatting.
     */
    private shouldTrackEdit(event: vscode.TextDocumentChangeEvent): boolean {
        // TODO This has to take a time component into consideration, otherwise as a user types
        // there is always one character change (VSCode doesn't batch these)
        return event.contentChanges.some((change) => change.text.length > 1 || change.rangeLength > 1)
    }

    /**
     * Add a new edit to the tracking system.
     */
    private addNewEdit(
        uri: string,
        timestamp: number,
        document: vscode.TextDocument,
        event: vscode.TextDocumentChangeEvent,
        edits: DocumentEdit[]
    ): void {
        // Add new edits
        for (const change of event.contentChanges) {
            const newEdit: DocumentEdit = {
                timestamp,
                range: {
                    start: {
                        line: change.range.start.line,
                        character: change.range.start.character,
                    },
                    end: {
                        line: change.range.end.line,
                        character: change.range.end.character,
                    },
                },
                text: change.text,
                rangeLength: change.rangeLength,
            }
            edits.push(newEdit)
        }

        // Remove old edits
        const cutoffTime = Date.now() - EditTracker.maxAgeMs
        const filteredEdits = edits.filter((e) => e.timestamp >= cutoffTime)

        this.fileEdits.set(uri, filteredEdits)
    }
}
