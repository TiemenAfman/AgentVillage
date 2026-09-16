// A zip file, written by hand, because the one thing the workbench needs a zip for is
// handing someone a folder of models and the four sheets they share - and a folder is all
// a zip has to be. Stored, never deflated: what goes in is PNG and base64 of PNG, which
// deflate has nothing left to take off, and STORE is the half of the format that fits in
// one screen.
//
// No zip64, so this tops out at four gigabytes and at 65535 files. The catalogue is
// seventy files and forty megabytes, and if either of those ever changes by three orders
// of magnitude, the zip is not the problem.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The date every entry is stamped with. A zip has nowhere to put a real timestamp that is
// not DOS's, and an entry with no date at all confuses some readers, so they all get the
// moment the zip was made.
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// `files` is [{ name, bytes }] with bytes a Uint8Array. Names are written as they are
// given: forward slashes make folders, and anything outside ASCII is left to the reader.
export function zip(files) {
  const enc = new TextEncoder();
  const { time, date } = dosTime(new Date());
  const parts = [];
  const central = [];
  let at = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const sum = crc32(f.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // the version that can read a stored entry
    local.setUint16(6, 0, true);
    local.setUint16(8, 0, true);         // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, sum, true);
    local.setUint32(18, f.bytes.length, true);
    local.setUint32(22, f.bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.bytes);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, sum, true);
    entry.setUint32(20, f.bytes.length, true);
    entry.setUint32(24, f.bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, at, true);       // where its local header starts
    central.push(new Uint8Array(entry.buffer), name);

    at += 30 + name.length + f.bytes.length;
  }

  const dirAt = at;
  let dirSize = 0;
  for (const p of central) dirSize += p.length;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, dirAt, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
