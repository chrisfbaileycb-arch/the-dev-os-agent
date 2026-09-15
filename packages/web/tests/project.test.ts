import { describe, expect, it } from 'vitest';
import { inlineLocalAssets, isSafeProjectPath, parseProject, placeholderImage, resolveLocalRef, stitchFragments, wrapScriptDocument } from '../src/lib/project';
import { highlightCode } from '../src/lib/highlight';

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

  // Stitching: sibling js/css fences fold into a lone html fence so the references the model
  // wrote resolve instead of 404ing against the sandbox shell.
  describe('sibling-block stitching', () => {
    it('replaces an external script tag with the sibling js block', () => {
      const reply = [
        fence('html', '<!doctype html><html><body><script src="game.js"></script></body></html>'),
        fence('js', 'const canvas = document.getElementById("c");'),
      ].join('\n\n');
      const project = parseProject(reply);
      expect(project?.files[0]?.content).toContain('const canvas = document.getElementById("c");');
      expect(project?.files[0]?.content).not.toContain('src="game.js"');
    });

    it('replaces an external stylesheet link with the sibling css block', () => {
      const reply = [
        fence('html', '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>Hi</body></html>'),
        fence('css', 'body { margin: 0; }'),
      ].join('\n\n');
      const project = parseProject(reply);
      expect(project?.files[0]?.content).toContain('body { margin: 0; }');
      expect(project?.files[0]?.content).not.toContain('href="style.css"');
    });

    it('classifies blocks by shape, so a css-named block containing rules lands in a style tag', () => {
      const doc = '<!doctype html><html><body><link rel="stylesheet" href="s.css"></body></html>';
      const out = stitchFragments(doc, ['body { margin: 0; color: red; }']);
      expect(out).toContain('<style>\nbody { margin: 0; color: red; }\n</style>');
      expect(out).not.toContain('href="s.css"');
    });

    it('drops an external reference that has no sibling block rather than leaving it to 404', () => {
      const doc = '<!doctype html><html><body><script src="missing.js"></script></body></html>';
      const out = stitchFragments(doc, []);
      expect(out).not.toContain('src="missing.js"');
    });

    it('leaves a self-contained document untouched', () => {
      const doc = '<!doctype html><html><body><script>console.log(1)</script></body></html>';
      expect(stitchFragments(doc, [])).toBeNull();
      const reply = fence('html', doc);
      expect(parseProject(reply)?.files[0]?.content).toBe(doc);
    });

    it('does not stitch a second copy when the document already carries an inline script', () => {
      const doc = '<!doctype html><html><body><script>let a = 1;</script></body></html>';
      const out = stitchFragments(doc, ['const b = 2;']);
      // No external reference to claim it, and the document already runs inline scripts: kept verbatim.
      expect(out).toBeNull();
    });

    it('wraps a bare fragment (no html/body wrappers) with the shell it needs', () => {
      const out = stitchFragments('<canvas id="c"></canvas>', ['const c = document.getElementById("c");']);
      expect(out).toContain('<!doctype html>');
      expect(out).toContain('<canvas id="c"></canvas>');
      expect(out).toContain('const c = document.getElementById("c");');
    });
  });

  describe('raw JavaScript wrapping', () => {
    it('wraps a raw executable JS fence in a responsive HTML5 shell', () => {
      const script = 'const canvas = document.createElement("canvas"); document.body.append(canvas);';
      const project = parseProject(fence('javascript', script));
      expect(project?.kind).toBe('html');
      expect(project?.files[0]?.content).toContain('<!DOCTYPE html>');
      expect(project?.files[0]?.content).toContain('<meta name="viewport"');
      expect(project?.files[0]?.content).toContain('background: #111');
      expect(project?.files[0]?.content).toContain(script);
    });

    it('exports the wrapper with a complete document and inline styles', () => {
      const result = wrapScriptDocument('requestAnimationFrame(() => {});', 'canvas { display: block; }');
      expect(result).toMatch(/^<!DOCTYPE html>[\s\S]*<html[\s\S]*<body>[\s\S]*<script>/);
      expect(result).toContain('canvas { display: block; }');
    });
  });

  describe('highlightCode', () => {
    it('escapes source HTML before adding token spans', () => {
      const result = highlightCode('const x = "<script>alert(1)</script>";');
      expect(result).not.toContain('<script>alert');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('syntax-keyword');
      expect(result).toContain('syntax-string');
    });
  });

  describe('raw-document fallback', () => {
    it('reads a complete document carried bare in the reply as a project', () => {
      const reply = 'Here is your page:\n\n<!DOCTYPE html>\n<html><body><h1>Hello</h1></body></html>\n\nLet me know if you want changes.';
      const project = parseProject(reply);
      expect(project).not.toBeNull();
      expect(project?.kind).toBe('html');
      expect(project?.entry).toBe('index.html');
      expect(project?.files[0]?.content).toContain('<h1>Hello</h1>');
    });

    it('stitches sibling js fences into the bare document too', () => {
      const reply = [
        '<!DOCTYPE html>\n<html><body><script src="app.js"></script></body></html>',
        fence('js', 'window.onload = () => console.log("ready");'),
      ].join('\n\n');
      const project = parseProject(reply);
      expect(project?.files[0]?.content).toContain('window.onload');
      expect(project?.files[0]?.content).not.toContain('src="app.js"');
    });

    it('still treats prose without a document as not-a-project', () => {
      const reply = `I could write that with:\n\n${fence('js', 'console.log(1)')}\n\nWant me to?`;
      expect(parseProject(reply)).toBeNull();
    });
  });
});

describe('resolveLocalRef', () => {
  const files = { 'index.html': '', 'styles.css': 'body{}', 'js/app.js': 'x', 'assets/logo.svg': '<svg/>' };
  it('resolves bare, ./ and / forms of a project path', () => {
    expect(resolveLocalRef('styles.css', files, 'index.html')).toBe('styles.css');
    expect(resolveLocalRef('./styles.css', files, 'index.html')).toBe('styles.css');
    expect(resolveLocalRef('/styles.css', files, 'index.html')).toBe('styles.css');
    expect(resolveLocalRef('styles.css?v=3', files, 'index.html')).toBe('styles.css');
  });
  it('resolves relative to the entry directory first, then falls back to a unique basename', () => {
    expect(resolveLocalRef('../styles.css', { ...files, 'public/index.html': '' }, 'public/index.html')).toBe('styles.css');
    expect(resolveLocalRef('app.js', files, 'index.html')).toBe('js/app.js');
    expect(resolveLocalRef('script/app.js', files, 'index.html')).toBe('js/app.js');
  });
  it('never treats a remote or data URL as a project file', () => {
    expect(resolveLocalRef('https://cdn.example/x.css', files, 'index.html')).toBeNull();
    expect(resolveLocalRef('//cdn.example/x.css', files, 'index.html')).toBeNull();
    expect(resolveLocalRef('data:text/css,body{}', files, 'index.html')).toBeNull();
    expect(resolveLocalRef('missing.css', files, 'index.html')).toBeNull();
  });
});

describe('inlineLocalAssets', () => {
  const files = {
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example/fa.css"><link href="./styles.css" rel="stylesheet"></head><body><img src="images/hero.jpg" alt="hero"><img src="https://pics.example/a.png"><img src="assets/logo.svg"><script src="app.js"></script><script type="module" src="./mod.js"></script></body></html>',
    'styles.css': 'body { color: red; }',
    'app.js': 'console.log("</script>")',
    'mod.js': 'export {}',
    'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  };
  const out = inlineLocalAssets(files['index.html'], files, 'index.html');
  it('inlines the project stylesheet whatever attribute order the tag used, and leaves the CDN link alone', () => {
    expect(out).toContain('<style data-inlined="styles.css">\nbody { color: red; }\n</style>');
    expect(out).toContain('<link rel="stylesheet" href="https://cdn.example/fa.css">');
    expect(out).not.toContain('href="./styles.css"');
  });
  it('inlines project scripts, keeping module type and escaping a closing tag inside the source', () => {
    expect(out).toContain('<script data-inlined="app.js">');
    expect(out).toContain('console.log("<\\/script>")');
    expect(out).toContain('<script type="module" data-inlined="mod.js">');
    expect(out).not.toMatch(/src="app\.js"/);
  });
  it('turns a project svg into a data URL, a missing local image into a placeholder, and leaves remote images as they are', () => {
    expect(out).toContain('src="data:image/svg+xml;charset=utf-8,');
    expect(out).toContain(`src="${placeholderImage('images/hero.jpg')}"`);
    expect(out).toContain('<img src="https://pics.example/a.png">');
  });
  it('names the missing file in the placeholder so the gap reads as a gap and not as a bug', () => {
    expect(decodeURIComponent(placeholderImage('images/hero.jpg'))).toContain('>hero.jpg<');
    expect(decodeURIComponent(placeholderImage('<evil>.png'))).not.toContain('<evil>');
  });
});
