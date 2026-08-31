import { crc32 } from "node:zlib";

// A zip writer in sixty lines, because the alternative is a dependency for one
// command. Entries are STORED rather than deflated: emoji and stickers are PNG,
// GIF or APNG, all already compressed, so deflating them buys a percent or two
// and costs the whole of zlib on every file.

const LOCAL = 0x04034b50;

const CENTRAL = 0x02014b50;

const END = 0x06054b50;

const DOS_TIME = 0;

const DOS_DATE = 0x21;

export interface Entry {
  name: string;
  body: Uint8Array;
}

function header(size: number): { view: DataView; bytes: Uint8Array } {
  const bytes = new Uint8Array(size);
  return { view: new DataView(bytes.buffer), bytes };
}

export function zip(entries: Entry[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const sum = crc32(entry.body);

    const { view, bytes } = header(30 + name.length);
    view.setUint32(0, LOCAL, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, DOS_TIME, true);
    view.setUint16(12, DOS_DATE, true);
    view.setUint32(14, sum, true);
    view.setUint32(18, entry.body.length, true);
    view.setUint32(22, entry.body.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    bytes.set(name, 30);

    const record = header(46 + name.length);
    record.view.setUint32(0, CENTRAL, true);
    record.view.setUint16(4, 20, true);
    record.view.setUint16(6, 20, true);
    record.view.setUint16(8, 0, true);
    record.view.setUint16(10, 0, true);
    record.view.setUint16(12, DOS_TIME, true);
    record.view.setUint16(14, DOS_DATE, true);
    record.view.setUint32(16, sum, true);
    record.view.setUint32(20, entry.body.length, true);
    record.view.setUint32(24, entry.body.length, true);
    record.view.setUint16(28, name.length, true);
    record.view.setUint32(42, offset, true);
    record.bytes.set(name, 46);

    parts.push(bytes, entry.body);
    central.push(record.bytes);
    offset += bytes.length + entry.body.length;
  }

  const size = central.reduce((total, one) => total + one.length, 0);
  const end = header(22);
  end.view.setUint32(0, END, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, size, true);
  end.view.setUint32(16, offset, true);

  const all = [...parts, ...central, end.bytes];
  const total = all.reduce((sum, one) => sum + one.length, 0);
  // over an explicit ArrayBuffer, so the result is not Uint8Array<ArrayBufferLike>,
  // which Blob will not take
  const out = new Uint8Array(new ArrayBuffer(total));

  let at = 0;
  for (const one of all) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

export function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^[._]+/, "").slice(0, 60);
  // "!!!" substitutes to "___", which is truthy and useless, so fall back on
  // there being nothing readable left rather than on the string being empty
  return /[a-zA-Z0-9]/.test(cleaned) ? cleaned : fallback;
}
