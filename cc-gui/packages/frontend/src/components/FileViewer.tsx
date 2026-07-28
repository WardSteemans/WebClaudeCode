import { useState, useEffect } from 'react';
import { File, X, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface FileViewerProps {
  filePath: string | null;
  baseDir: string | null;
  onClose: () => void;
  onToggleCollapse: () => void;
  collapsed: boolean;
}

const LANG_MAP: Record<string, string> = {
  typescript: 'typescript', tsx: 'tsx', javascript: 'javascript', jsx: 'jsx',
  json: 'json', css: 'css', html: 'markup', md: 'markdown',
  python: 'python', rust: 'rust', go: 'go', java: 'java', c: 'c',
  cpp: 'cpp', bash: 'bash', yaml: 'yaml', yml: 'yaml',
  xml: 'xml', sql: 'sql', graphql: 'graphql', toml: 'toml',
  dockerfile: 'docker', plaintext: 'plaintext',
};

export function FileViewer({ filePath, baseDir, onClose, onToggleCollapse, collapsed }: FileViewerProps) {
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!filePath || !baseDir) return;
    setLoading(true);
    setError('');
    fetch(`/api/fs/read?file=${encodeURIComponent(filePath)}&base=${encodeURIComponent(baseDir)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setContent(data.content || '');
          setLanguage(LANG_MAP[data.language] || 'plaintext');
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [filePath, baseDir]);

  if (!filePath) return null;

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)] border-l border-[var(--color-border)] transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0 transition-colors">
        <File size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-[13px] text-[var(--color-text)] truncate flex-1">{fileName}</span>
        <button
          onClick={onToggleCollapse}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md p-0.5 transition-colors"
          title={collapsed ? 'Expand viewer' : 'Collapse viewer'}
        >
          {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
        <button
          onClick={onClose}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md p-0.5 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && <div className="p-4 text-[var(--color-text-muted)] text-sm text-center">Loading…</div>}
        {error && <div className="p-4 text-red-500 text-sm">{error}</div>}
        {!loading && !error && (
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: '16px',
              fontSize: '13px',
              background: '#0d1117',
              minHeight: '100%',
            }}
            showLineNumbers
            lineNumberStyle={{ color: '#374151', minWidth: '2em' }}
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
