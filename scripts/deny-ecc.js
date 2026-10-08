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
    if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.vscode') continue;
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

function packageNames(file, json) {
  const names = [];
  if (file.endsWith('package.json')) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      names.push(...Object.keys(json[field] || {}));
    }
    return names;
  }
  const packages = json.packages || {};
  for (const key of Object.keys(packages)) {
    const marker = 'node_modules/';
    const at = key.lastIndexOf(marker);
    if (at === -1) continue;
    names.push(key.slice(at + marker.length));
  }
  return names;
}

function hit(name) {
  const lower = name.toLowerCase();
  return forbidden.find(token => lower === token || lower.endsWith('/' + token) || lower.includes(token));
}

const files = collectFiles(repoRoot);
const hits = [];

for (const file of files) {
  let json;
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { continue; }
  for (const name of packageNames(file, json)) {
    const token = hit(name);
    if (token) hits.push({ file, token, name });
  }
}

if (hits.length > 0) {
  console.error('ECC-related dependency guard triggered.');
  for (const item of hits) {
    console.error(` - ${path.relative(repoRoot, item.file)} depends on "${item.name}" (${item.token})`);
  }
  console.error('');
  console.error('This repository is a Vite/React app and should not include ECC tooling or crypto key libraries in its build graph.');
  process.exit(1);
}

console.log('No ECC-related dependency names found in package manifests or lockfiles.');
