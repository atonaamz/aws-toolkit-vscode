/**
 * Strips common indentation from each line of code that may contain HTML tags
 * @param lines Array of code lines (may contain HTML tags)
 * @returns Array of code lines with common indentation removed
 */
export function stripCommonIndentation(lines: string[]): string[] {
    const getTextOnly = (line: string) => line.replace(/^<[^>]*>/g, '')
    const minIndent = Math.min(...lines.map((line) => getTextOnly(line).match(/^\s*/)?.[0].length || 0))
    return lines.map((line) => {
        const leadingSpaces = getTextOnly(line).match(/^\s*/)?.[0] || ''
        return line.replace(leadingSpaces, leadingSpaces.substring(minIndent))
    })
}
