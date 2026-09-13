import { describe, expect, it } from 'vitest';
import { isSafeProjectPath, parseProject } from '../src/lib/project';

const fence = (info: string, body: string) => `\`\`\`${info}\n${body}\n\`\`\``;

describe('isSafeProjectPath', () => {
  it('accepts ordinary relative project paths', () => {
    expect(isSafeProjectPath('src/App.tsx')).toBe(true);
    expect(isSafeProjectPath('package.json')).toBe(true);
    expect(isSafeProjectPath('a/b/c.d.css')).toBe(true);
  });
  it('rejects traversal, absolute paths, and odd characters', () => {
    expect(isSafeProjectPath('../secrets.env')).toBe(false);
    expect(isSafeProjectPath('a/../../etc/passwd')).toBe(false);
    expect(isSafeProjectPath('/etc/passwd')).toBe(false);
    expect(isSafeProjectPath('C:\\Windows\\win.ini')).toBe(false);
    expect(isSafeProjectPath('a\0b')).toBe(false);
  });
});

describe('parseProject', () => {
  it('reads a lone html fence as a one-file project', () => {
    const reply = `Here you go:\n\n${fence('html', '<!doctype html><html><body>Hi</body></html>')}\n\nEnjoy.`;
    const project = parseProject(reply);
    expect(project).not.toBeNull();
    expect(project?.kind).toBe('html');
    expect(project?.entry).toBe('index.html');
    expect(project?.files).toHaveLength(1);
    expect(project?.files[0].content).toContain('Hi');
  });

  it('does not treat a bare-language fence with no path as a project when mixed with prose', () => {
    const reply = `Try this:\n\n${fence('js', 'console.log(1)')}\n\nThat should work.`;
    expect(parseProject(reply)).toBeNull();
  });

  it('assembles a multi-file React project from path-per-fence blocks', () => {
    const reply = [
      'Here is a counter app.',
      fence('package.json', '{"dependencies": {"react": "18.3.1", "react-dom": "18.3.1"}}'),
      fence('src/main.tsx', "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')!).render(<App />);"),
      fence('src/App.tsx', 'export default function App() { return <div>Count</div>; }'),
      fence('src/App.css', '.count { color: red; }'),
    ].join('\n\n');
    const project = parseProject(reply);
    expect(project).not.toBeNull();
    expect(project?.kind).toBe('react');
    expect(project?.entry).toBe('src/main.tsx');
    expect(project?.dependencies).toEqual({ react: '18.3.1', 'react-dom': '18.3.1' });
    expect(project?.files.map(f => f.path).sort()).toEqual(['package.json', 'src/App.css', 'src/App.tsx', 'src/main.tsx']);
  });

  it('picks App.tsx as the entry when no main/index file is present', () => {
    const reply = fence('src/App.tsx', 'export default function App() { return <div />; }');
    const project = parseProject(reply);
    expect(project?.entry).toBe('src/App.tsx');
  });

  it('recognizes a path declared via title= or filename= attributes', () => {
    const reply = [fence('tsx title="src/Widget.tsx"', 'export default function Widget() { return null; }')].join('\n');
    const project = parseProject(reply);
    expect(project?.files[0]?.path).toBe('src/Widget.tsx');
  });

  it('recognizes a path declared via a leading comment when the fence uses a bare language', () => {
    const reply = fence('tsx', '// src/Header.tsx\nexport default function Header() { return null; }');
    const project = parseProject(reply);
    expect(project?.files[0]?.path).toBe('src/Header.tsx');
  });

  it('drops a declared path that fails safety validation instead of trusting it', () => {
    const reply = [
      fence('src/App.tsx', 'export default function App() { return null; }'),
      fence('../../etc/passwd', 'root:x:0:0'),
    ].join('\n\n');
    const project = parseProject(reply);
    expect(project?.files).toHaveLength(1);
    expect(project?.files[0]?.path).toBe('src/App.tsx');
  });

  it('deduplicates a path declared twice, keeping the first occurrence', () => {
    const reply = [fence('src/App.tsx', 'first'), fence('src/App.tsx', 'second')].join('\n\n');
    const project = parseProject(reply);
    expect(project?.files).toHaveLength(1);
    expect(project?.files[0]?.content).toBe('first');
  });

  it('falls back to an html entry for a pathed project with no React signal', () => {
    const reply = [fence('index.html', '<html></html>'), fence('style.css', 'body{}')].join('\n\n');
    const project = parseProject(reply);
    expect(project?.kind).toBe('html');
    expect(project?.entry).toBe('index.html');
  });

  it('returns null for plain conversational text', () => {
    expect(parseProject('Sure, happy to help with that question.')).toBeNull();
  });
});
