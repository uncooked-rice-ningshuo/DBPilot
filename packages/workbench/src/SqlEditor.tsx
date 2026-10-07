import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

const workerScope = self as typeof self & { MonacoEnvironment?: { getWorker: () => Worker } };
workerScope.MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.editor.defineTheme('dbpilot-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '171717', fontStyle: 'bold' },
    { token: 'string', foreground: '525252' },
    { token: 'number', foreground: '525252' },
    { token: 'comment', foreground: 'A3A3A3', fontStyle: 'italic' }
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#262626',
    'editorLineNumber.foreground': '#A3A3A3',
    'editorLineNumber.activeForeground': '#525252',
    'editorGutter.background': '#FAFAFA',
    'editor.lineHighlightBackground': '#F5F5F5',
    'editorCursor.foreground': '#171717',
    'editor.selectionBackground': '#E5E5E5'
  }
});

export function SqlEditor({ value, onChange, onExecute }: { value: string; onChange: (value: string) => void; onExecute: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  onChangeRef.current = onChange;
  onExecuteRef.current = onExecute;

  useEffect(() => {
    if (!container.current) return;
    const instance = monaco.editor.create(container.current, {
      value,
      language: 'sql',
      theme: 'dbpilot-light',
      automaticLayout: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 22,
      lineNumbers: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      renderLineHighlight: 'line',
      padding: { top: 16, bottom: 16 }
    });
    editor.current = instance;
    const change = instance.onDidChangeModelContent(() => onChangeRef.current(instance.getValue()));
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onExecuteRef.current());
    return () => { change.dispose(); instance.dispose(); editor.current = null; };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (instance && instance.getValue() !== value) instance.setValue(value);
  }, [value]);

  return <div ref={container} className="sql-editor" role="region" aria-label="SQL 编辑器" />;
}
