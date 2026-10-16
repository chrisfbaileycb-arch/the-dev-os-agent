import { describe, expect, it } from 'vitest';
import { MCP_PRESETS, MCP_PRESET_GROUPS, presetConnected, presetForm } from '../src/lib/mcpPresets';

const REMOVED = ['thinking', 'database', 'fs', 'jira', 'huggingface', 'context7', 'deepwiki', 'cloudflare-docs'];

describe('MCP presets', () => {
  it('lists unique ids and https URLs the server guard will accept', () => {
    expect(new Set(MCP_PRESETS.map(p => p.id)).size).toBe(MCP_PRESETS.length);
    expect(MCP_PRESETS).toHaveLength(23);
    for (const p of MCP_PRESETS.filter(p => p.kind === 'remote')) {
      const url = new URL(p.url);
      expect(url.protocol).toBe('https:');
      expect(url.username).toBe('');
      expect(url.hostname.endsWith('.internal')).toBe(false);
    }
  });
  it('never invents remote URLs for local bridges', () => {
    for (const preset of MCP_PRESETS.filter(p => p.kind !== 'remote')) { expect(preset.url).toBe(''); expect(preset.docs.startsWith('https://')).toBe(true); }
    for (const id of ['filesystem', 'sqlite', 'docker', 'brave', 'puppeteer']) expect(MCP_PRESETS.find(p => p.id === id)?.kind).toBe('bridge');
    // The two optional media tools live in their own accordion in the drawer, not in this grid,
    // so the real MCP tool count is not padded by cards that are not MCP servers at all.
    for (const id of ['heygen', 'nano-banana']) expect(MCP_PRESETS.find(p => p.id === id)).toBeUndefined();
  });
  it('puts every preset in a known group', () => {
    for (const p of MCP_PRESETS) expect(MCP_PRESET_GROUPS).toContain(p.group);
  });
  it('prefills the form with the preset name, URL, and guessed transport', () => {
    expect(presetForm({ ...MCP_PRESETS[0], url: 'https://example.com/sse' }).transport).toBe('sse');
    expect(presetForm(MCP_PRESETS[0]).transport).toBe('http');
  });
  it('recognises a connected server despite a trailing slash or case', () => {
    const github = MCP_PRESETS.find(p => p.id === 'github')!;
    expect(presetConnected(github, [{ url: 'https://API.githubcopilot.com/mcp' }])).toBe(true);
    expect(presetConnected(github, [{ url: 'https://mcp.linear.app/mcp' }])).toBe(false);
  });
  it('does not ship the in-process ECC tool stand-ins', () => {
    for (const id of REMOVED) expect(MCP_PRESETS.find(p => p.id === id)).toBeUndefined();
  });
});
