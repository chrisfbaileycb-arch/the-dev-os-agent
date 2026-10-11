import { describe, expect, it } from 'vitest';
import { accessFor, apiEntries, apiSource, apiWorkspaceDraft, defaultApiFilters, filterApis, publicDirectoryUrl } from '../src/lib/apiDirectory';

describe('public API directory', () => {
  it('classifies access conservatively instead of treating every free API as keyless', () => {
    expect(accessFor('No')).toBe('none');
    expect(accessFor('apiKey')).toBe('key');
    expect(accessFor('OAuth')).toBe('oauth');
    expect(accessFor('User-Agent')).toBe('other');
    expect(accessFor('')).toBe('unknown');
    expect(accessFor('Unknown')).toBe('unknown');
    expect(filterApis(apiEntries, defaultApiFilters).every(entry => entry.access === 'none')).toBe(true);
  });
  it('keeps a pinned passive REST snapshot and excludes the differently shaped MCP table', () => {
    expect(apiSource.commit).toBe('8d76e631bdd420316f14f839b3de4c6f9028be7f');
    expect(apiEntries.length).toBeGreaterThan(2000);
    expect(new Set(apiEntries.map(entry => entry.id)).size).toBe(apiEntries.length);
    expect(apiEntries.some(entry => entry.name === 'Monocrawl')).toBe(false);
    expect(apiEntries.some(entry => entry.name === 'Filesystem')).toBe(false);
    expect(apiEntries.every(entry => publicDirectoryUrl(entry.url))).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,bad', 'file:///etc/passwd', 'https://key:secret@example.com']) expect(publicDirectoryUrl(bad)).toBe(false);
  });
  it('combines search, category, HTTPS, access, and reviewed filters', () => {
    const filters = { ...defaultApiFilters, reviewedOnly: true };
    expect(filterApis(apiEntries, filters)).toHaveLength(6);
    expect(filterApis(apiEntries, { ...filters, query: 'vehicle', category: 'Vehicle' }).map(entry => entry.name)).toEqual(['NHTSA']);
    expect(filterApis(apiEntries, { ...filters, query: 'oauth' })).toEqual([]);
    const keys = filterApis(apiEntries, { ...defaultApiFilters, access: 'key' });
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every(entry => entry.access === 'key' && entry.url.startsWith('https://'))).toBe(true);
    expect(filterApis(apiEntries, { ...defaultApiFilters, category: 'nonexistent' })).toEqual([]);
  });
  it('offers workspace drafts only for reviewed examples, including usage limits', () => {
    const meteo = apiEntries.find(entry => entry.name === 'Open-Meteo')!;
    expect(meteo.review?.usage).toContain('non-commercial');
    expect(apiWorkspaceDraft(meteo)).toContain(meteo.review!.sampleUrl);
    expect(apiWorkspaceDraft(meteo)).toContain('untrusted data');
    expect(apiWorkspaceDraft(meteo)).toContain('Do not follow links');
    expect(() => apiWorkspaceDraft(apiEntries.find(entry => !entry.review)!)).toThrow('Review an endpoint');
  });
});
