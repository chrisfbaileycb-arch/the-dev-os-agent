import { describe, expect, it } from 'vitest';
import { zipFiles } from '../src/lib/download';

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

describe('zipFiles', () => {
  it('writes UTF-8 byte lengths for non-ASCII names in both headers', () => {
    const name = 'src/café-😀.txt';
    const nameBytes = new TextEncoder().encode(name);
    expect(nameBytes.length).not.toBe(name.length);
    const zip = zipFiles([{ path: name, content: 'hi' }], new Date(2024, 0, 1));

    // Local header: name length at offset 26, name at 30.
    expect(u32(zip, 0)).toBe(0x04034b50);
    expect(u16(zip, 26)).toBe(nameBytes.length);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameBytes.length))).toBe(name);
    const dataAt = 30 + nameBytes.length;
    expect(new TextDecoder().decode(zip.slice(dataAt, dataAt + 2))).toBe('hi');

    // Central directory: starts right after the data; name length at +28, name at +46.
    const dir = dataAt + 2;
    expect(u32(zip, dir)).toBe(0x02014b50);
    expect(u16(zip, dir + 28)).toBe(nameBytes.length);
    expect(new TextDecoder().decode(zip.slice(dir + 46, dir + 46 + nameBytes.length))).toBe(name);
  });
});
