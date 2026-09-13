import { describe, expect, it } from 'vitest';
import { esmUrl, resolveRelative } from '../src/lib/bundle/plugin';

describe('esmUrl', () => {
  it('points an unpinned bare specifier at esm.sh unversioned', () => {
    expect(esmUrl('react', {})).toBe('https://esm.sh/react');
  });
  it('pins the version from the project\'s own package.json when present', () => {
    expect(esmUrl('react', { react: '18.3.1' })).toBe('https://esm.sh/react@18.3.1');
  });
  it('strips a semver range prefix before pinning', () => {
    expect(esmUrl('react-dom', { 'react-dom': '^18.3.1' })).toBe('https://esm.sh/react-dom@18.3.1');
  });
  it('keeps a subpath export attached to its package, not swallowed into the version', () => {
    expect(esmUrl('react-dom/client', { 'react-dom': '18.3.1' })).toBe('https://esm.sh/react-dom@18.3.1/client');
  });
  it('treats a scoped package\'s first two segments as its name', () => {
    expect(esmUrl('@radix-ui/react-slot', { '@radix-ui/react-slot': '1.0.0' })).toBe('https://esm.sh/@radix-ui/react-slot@1.0.0');
  });
  it('keeps a scoped package\'s subpath intact', () => {
    expect(esmUrl('@radix-ui/react-slot/dist/foo', {})).toBe('https://esm.sh/@radix-ui/react-slot/dist/foo');
  });
});

describe('resolveRelative', () => {
  const files = { 'src/App.tsx': '', 'src/App.css': '', 'src/components/Button.tsx': '', 'src/utils/index.ts': '' };
  it('resolves a sibling import with an explicit extension', () => {
    expect(resolveRelative('./App.css', 'src/main.tsx', files)).toBe('src/App.css');
  });
  it('probes extensions when the import omits one', () => {
    expect(resolveRelative('./App', 'src/main.tsx', files)).toBe('src/App.tsx');
  });
  it('walks up a directory with ..', () => {
    expect(resolveRelative('../App', 'src/components/Button.tsx', files)).toBe('src/App.tsx');
  });
  it('resolves a folder import to its index file', () => {
    expect(resolveRelative('./utils', 'src/main.tsx', files)).toBe('src/utils/index.ts');
  });
  it('resolves a root-relative import against the project root', () => {
    expect(resolveRelative('/src/App', 'src/components/Button.tsx', files)).toBe('src/App.tsx');
  });
  it('returns null when nothing in the project matches', () => {
    expect(resolveRelative('./Missing', 'src/main.tsx', files)).toBeNull();
  });
});
