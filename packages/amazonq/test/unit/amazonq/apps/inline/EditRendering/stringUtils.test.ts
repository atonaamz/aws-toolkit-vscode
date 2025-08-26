import assert from 'assert'
import { stripCommonIndentation } from '../../../../../../src/app/inline/EditRendering/stringUtils'

describe('stripCommonIndentation', () => {
    it('should strip common leading whitespace', () => {
        const input = ['    line1 ', '    line2 ', '        line3   ']
        const expected = ['line1 ', 'line2 ', '    line3   ']
        assert.strictEqual(stripCommonIndentation(input), expected)
    })

    it('should handle HTML tags', () => {
        const input = ['<span>line1</span>       line1 </span>', '<span>line2</span>   line2  </span>']
        const expected = ['<span>line1</span>    line1 </span>', '<span>line2</span>   line2  </span>']
        assert.strictEqual(stripCommonIndentation(input), expected)
    })

    it('should handle mixed indentation', () => {
        const input = [' line1', '    line2', '  line3']
        const expected = ['line1', '   line2', ' line3']
        assert.strictEqual(stripCommonIndentation(input), expected)
    })

    it('should handle empty lines', () => {
        const input = ['    line1', '', '    line2']
        const expected = ['line1', '', 'line2']
        assert.strictEqual(stripCommonIndentation(input), expected)
    })

    it('should handle no indentation', () => {
        const input = ['line1', 'line2']
        const expected = ['line1', 'line2']
        assert.strictEqual(stripCommonIndentation(input), expected)
    })

    it('should handle single line', () => {
        const input = ['    single line']
        const expected = ['single line']
        assert.strictEqual(stripCommonIndentation(input), expected)
    })
})
