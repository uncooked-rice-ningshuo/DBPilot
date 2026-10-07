import React, { memo, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './button';
import { notify } from '../notify';

function codeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(codeText).join('');
  if (React.isValidElement<{children?: ReactNode}>(node)) return codeText(node.props.children);
  return '';
}
/** Untrusted model prose: no raw HTML, embedded media or executable link schemes. */
export const MarkdownMessage = memo(function MarkdownMessage({ text, canCopy = true }: {text:string;canCopy?:boolean}) {
  return <div className="markdown-message"><Markdown skipHtml remarkPlugins={[remarkGfm]}
    urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}
    components={{
      img: ({alt}) => <span className="markdown-image-label">{alt ? `[图片：${alt}]` : '[图片未加载]'}</span>,
      a: ({href,children}) => href ? <a href={href} title={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      table: ({children}) => <div className="markdown-table"><table>{children}</table></div>,
      pre: ({children}) => <div className="markdown-code"><div className="markdown-code-actions"><Button type="button" variant="ghost" size="sm" disabled={!canCopy} onClick={async () => {
        try { const text = codeText(children).replace(/\n$/, ''); if (window.dbpilotDesktop?.copyText) await window.dbpilotDesktop.copyText(text); else await navigator.clipboard.writeText(text); notify.success('代码已复制，尚未执行。'); }
        catch { notify.error('无法访问剪贴板，请选择代码后手动复制。'); }
      }}>复制代码</Button></div><pre>{children}</pre></div>,
    }}>{text}</Markdown></div>;
});
