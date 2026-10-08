#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const forbidden = [
  'ecc',
  'elliptic',
  'secp256k1',
  '@noble/secp256k1',
  'ethereum-cryptography',
  'ecdsa',
  'ed25519',
  'curve25519'
];

function isIgnoredDir(name) {
  return [
    '.git',
    'node_modules',
    '.next',
    'dist',
    'build',
    '.turbo',
    '.cache',
    '.venv',
    '__pycache__'
  ].includes(name);
}

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      if (entry.name === '.github' || entry.name === '.vscode') continue;
    }
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (/package\.json$|package-lock\.json$|npm-shrinkwrap\.json$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = collectFiles(repoRoot);
const hits = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of forbidden) {
    const haystack = text.toLowerCase();
    const needle = token.toLowerCase();
    if (haystack.includes(needle)) {
      hits.push({ file, token });
      break;
    }
  }
}

if (hits.length > 0) {
  console.error('ECC-related dependency guard triggered.');
  for (const hit of hits) {
    console.error(` - ${path.relative(repoRoot, hit.file)} contains "${hit.token}"`);
  }
  console.error('');
  console.error('This repository is a Vite/React app and should not include ECC tooling or crypto key libraries in its build graph.');
  process.exit(1);
}

console.log('No ECC-related dependency names found in package manifests or lockfiles.');
