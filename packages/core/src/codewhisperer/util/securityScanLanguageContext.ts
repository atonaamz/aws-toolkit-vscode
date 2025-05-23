/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CodewhispererLanguage } from '../../shared/telemetry/telemetry.gen'
import { ConstantMap, createConstantMap } from '../../shared/utilities/tsUtils'
import * as CodeWhispererConstants from '../models/constants'

export class SecurityScanLanguageContext {
    private supportedLanguageMap: ConstantMap<CodeWhispererConstants.SecurityScanLanguageId, CodewhispererLanguage>

    constructor() {
        this.supportedLanguageMap = createConstantMap<
            CodeWhispererConstants.SecurityScanLanguageId,
            CodewhispererLanguage
        >({
            java: 'java',
            python: 'python',
            javascript: 'javascript',
            javascriptreact: 'javascript',
            typescript: 'typescript',
            typescriptreact: 'typescript',
            csharp: 'csharp',
            go: 'go',
            golang: 'go',
            ruby: 'ruby',
            json: 'json',
            jsonc: 'json',
            yaml: 'yaml',
            tf: 'tf',
            hcl: 'tf',
            terraform: 'tf',
            terragrunt: 'tf',
            packer: 'tf',
            plaintext: 'plaintext',
            c: 'c',
            cpp: 'cpp',
            php: 'php',
            xml: 'plaintext', // xml does not exist in CodewhispererLanguage
            toml: 'plaintext',
            'pip-requirements': 'plaintext',
            'java-properties': 'plaintext',
            'go.mod': 'plaintext',
            'go.sum': 'plaintext',
            kotlin: 'kotlin',
            scala: 'scala',
            sh: 'shell',
            shell: 'shell',
            shellscript: 'shell',
            brazilPackageConfig: 'plaintext',
        })
    }

    public normalizeLanguage(languageId?: string): CodewhispererLanguage | undefined {
        return this.supportedLanguageMap.get(languageId)
    }

    public isLanguageSupported(languageId: string): boolean {
        const lang = this.normalizeLanguage(languageId)
        return lang !== undefined && lang !== 'plaintext'
    }
}

export const securityScanLanguageContext = new SecurityScanLanguageContext()
