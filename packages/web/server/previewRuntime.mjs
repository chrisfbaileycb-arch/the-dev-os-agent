import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
export function previewRuntimeModules() {
  const source = (pkg, file) => readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'cjs', file), 'utf8');
  return {
    react: source('react', 'react.production.js'),
    'react/jsx-runtime': source('react', 'react-jsx-runtime.production.js'),
    'react/jsx-dev-runtime': source('react', 'react-jsx-dev-runtime.production.js'),
    'react/compiler-runtime': source('react', 'react-compiler-runtime.production.js'),
    'react-dom': source('react-dom', 'react-dom.production.js'),
    'react-dom/client': source('react-dom', 'react-dom-client.production.js'),
    scheduler: source('scheduler', 'scheduler.production.js'),
  };
}

export function previewRuntimePlugin() {
  return {
    name: 'isolated-preview-react-runtime',
    resolveId(id) { if (id === 'virtual:preview-runtime') return '\0virtual:preview-runtime'; },
    load(id) { if (id === '\0virtual:preview-runtime') return `export default ${JSON.stringify(previewRuntimeModules())};`; },
  };
}
