import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Inline the pinned parser into the opaque shell: no new CSP grants or CDN request.
export function sandboxDocument() {
  const shell = readFileSync(new URL('../public/sandbox.html', import.meta.url), 'utf8');
  const parser = readFileSync(require.resolve('acorn'), 'utf8');
  // Serialize source rather than putting vendor comments/strings into the HTML parser.
  const literal = JSON.stringify(parser).replace(/</g, '\\u003c');
  return shell.replace('/* __PREVIEW_SCRIPT_PARSER__ */', () => '(0, eval)(' + literal + ');');
}

export function sandboxDocumentPlugin() {
  return {
    name: 'preview-script-parser',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/sandbox.html') return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(sandboxDocument());
      });
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'sandbox.html', source: sandboxDocument() }); },
  };
}
