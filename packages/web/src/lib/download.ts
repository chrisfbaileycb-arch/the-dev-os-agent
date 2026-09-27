// Turning project files into something that leaves the browser: one file, or the whole project as
// a .zip.
//
// There is no zip library in this app's dependencies and adding one for two buttons is not worth
// it: what a generated workspace needs from an archive is fidelity, not compression. So `zipFiles`
// writes a STORE (method 0) archive by hand — a valid ZIP that any OS unpacker, GitHub's own upload,
// CodeSandbox or StackBlitz will open — with CRC-32s computed here. Deflate would save a few
// kilobytes on a text project and cost a dependency; whoever cares about size can compress the
// folder after unpacking it.
//
// The layout follows the ZIP spec's two halves exactly: a local file header plus its bytes for each
// entry, then the central directory that indexes them, then the end-of-central-directory record that
// says where the directory starts. Every offset is measured from the front of the stream, so a
// running length is the only bookkeeping needed.

import type { ProjectFile } from './project';

const encoder = new TextEncoder();

/** The reflected CRC-32 polynomial every ZIP implementation uses. */
const CRC_POLY = 0xedb88320;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? CRC_POLY ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time, which is what a ZIP stores instead of a Unix timestamp. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface ZipEntry { name: string; nameBytes: Uint8Array; bytes: Uint8Array; crc: number; offset: number; }

/** Little-endian scratch: the ZIP format is all fixed-width LE fields, so building it is a write cursor. */
class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;
  raw(bytes: Uint8Array): void { this.chunks.push(bytes); this.length += bytes.length; }
  u16(value: number): void { this.raw(new Uint8Array([value & 0xff, (value >>> 8) & 0xff])); }
  u32(value: number): void { this.raw(new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])); }
  text(value: string): void { this.raw(encoder.encode(value)); }
  /** The whole buffer as one contiguous byte string — what a Blob takes, and what the tests read back. */
  get(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) { out.set(chunk, at); at += chunk.length; }
    return out;
  }
}

/**
 * A STORE-method .zip holding one entry per file, in the order given.
 *
 * Paths are normalised to forward slashes with no leading `./`, which is what every unpacker
 * expects and what the project's own paths already are. The version-needed field is 20 (2.0), the
 * minimum for a plain stored file with a DOS timestamp.
 */
export function zipFiles(files: ProjectFile[], when = new Date()): Uint8Array {
  const { time, date } = dosDateTime(when);
  const body = new ByteWriter();
  const entries: ZipEntry[] = [];

  for (const file of files) {
    const name = file.path.replace(/^\.?\//, '').replace(/\\/g, '/');
    // The header length fields count UTF-8 bytes, not UTF-16 code units: encode the name once and
    // use that byte array for both the length and the name itself, in both headers.
    const nameBytes = encoder.encode(name);
    const bytes = encoder.encode(file.content);
    const crc = crc32(bytes);
    const local = new ByteWriter();
    local.u32(0x04034b50);          // local file header signature
    local.u16(20);                  // version needed to extract: 2.0
    local.u16(0x0800);              // general purpose flag bit 11: file names are UTF-8
    local.u16(0);                   // compression method 0 — stored
    local.u16(time);
    local.u16(date);
    local.u32(crc);
    local.u32(bytes.length);        // compressed size
    local.u32(bytes.length);        // uncompressed size
    local.u16(nameBytes.length);    // file name length, in bytes
    local.u16(0);                   // no extra field
    local.raw(nameBytes);
    const offset = body.length;
    body.raw(local.get());
    body.raw(bytes);
    entries.push({ name, nameBytes, bytes, crc, offset });
  }

  const directory = new ByteWriter();
  for (const entry of entries) {
    directory.u32(0x02014b50);      // central directory file header signature
    directory.u16(20);              // version made by
    directory.u16(20);              // version needed to extract
    directory.u16(0x0800);          // flags: UTF-8 names, same as the local header
    directory.u16(0);               // method: stored
    directory.u16(time);
    directory.u16(date);
    directory.u32(entry.crc);
    directory.u32(entry.bytes.length);
    directory.u32(entry.bytes.length);
    directory.u16(entry.nameBytes.length);
    directory.u16(0);               // extra
    directory.u16(0);               // comment
    directory.u16(0);               // disk number start
    directory.u16(0);               // internal attributes
    directory.u32(0);               // external attributes
    directory.u32(entry.offset);
    directory.raw(entry.nameBytes);
  }

  const end = new ByteWriter();
  const directoryOffset = body.length;
  const directoryBytes = directory.get();
  end.u32(0x06054b50);              // end of central directory signature
  end.u16(0);                       // this disk
  end.u16(0);                       // disk with the directory
  end.u16(entries.length);          // entries on this disk
  end.u16(entries.length);          // entries total
  end.u32(directoryBytes.length);
  end.u32(directoryOffset);
  end.u16(0);                       // no archive comment

  const out = new ByteWriter();
  out.raw(body.get());
  out.raw(directoryBytes);
  out.raw(end.get());
  return out.get();
}

/** A Blob for the archive, typed so browsers name the download `.zip` rather than `.octet-stream`. */
export function zipBlob(files: ProjectFile[]): Blob {
  return new Blob([zipFiles(files) as unknown as ArrayBuffer], { type: 'application/zip' });
}

/**
 * Save a blob under a name, through a throwaway anchor.
 *
 * Exported because three surfaces want the same behaviour (the toolbar's Download button, the sync
 * drawer's "save what I pulled", and session export elsewhere), and because the revoke has to be
 * deferred: Safari unloads the page as soon as the click returns, and an object URL revoked in the
 * same tick takes the download with it.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** `src/App.tsx` -> `App.zip`, falling back to a stable name for a project with no path to borrow. */
export function archiveName(entry: string | undefined): string {
  if (!entry) return 'hey-buddy-project.zip';
  const base = entry.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
  return `${base || 'project'}.zip`;
}
