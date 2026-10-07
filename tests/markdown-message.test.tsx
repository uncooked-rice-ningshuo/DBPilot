import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {MarkdownMessage} from '../packages/ui/src/components/markdown-message';
it('renders untrusted Markdown without active HTML, executable links, or image requests',()=>{
 const text='<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>\n\n[x](javascript:alert%281%29)\n\n![tracking](https://evil.test/pixel)\n\n[safe](https://example.test/doc)';
 const html=renderToStaticMarkup(<MarkdownMessage text={text}/>);
 expect(html).not.toMatch(/<(script|iframe|img)\b/);expect(html).not.toContain('href="javascript:');expect(html).not.toContain('src=');expect(html).toContain('href="https://example.test/doc"');expect(html).toContain('rel="noopener noreferrer"');
});
it('keeps SQL inert and disables code copying while a response is incomplete',()=>{
 const html=renderToStaticMarkup(<MarkdownMessage canCopy={false} text={'```sql\nSELECT \'<script>\';\n```\n\n|a|b|\n|-|-|\n|1|2|'}/>);
 expect(html).toContain('&lt;script&gt;');expect(html).toContain('<table>');expect(html).toContain('disabled=""');expect(html).not.toContain('onclick=');
});
