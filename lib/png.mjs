import zlib from 'node:zlib';

// A minimal PNG writer. The repo has no runtime dependencies and this is the whole reason
// the island can be judged as a picture without starting a game engine - sixty lines against
// a dependency tree seemed a good trade.
//
// Truecolour, 8 bits per channel, filter 0 on every scanline. No interlacing, no palette:
// the images are heightfield renders, so compression does better on raw rows than any
// filter heuristic would gain.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgb  width * height * 3 bytes, row-major from the top left
 * @returns {Buffer} the complete PNG file
 */
export function encodePng(width, height, rgb) {
  if (rgb.length !== width * height * 3) {
    throw new Error(`expected ${width * height * 3} bytes of pixel data, got ${rgb.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 2;        // colour type: truecolour
  ihdr[10] = 0;       // compression: deflate
  ihdr[11] = 0;       // filter method
  ihdr[12] = 0;       // no interlace

  // One filter byte per row, then the row itself.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const src = y * width * 3;
    const dst = y * (1 + width * 3);
    raw[dst] = 0;
    raw.set(rgb.subarray(src, src + width * 3), dst + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A tiny helper for building the pixel buffer: set one pixel from 0..1 floats. */
export function makeCanvas(width, height) {
  const rgb = new Uint8Array(width * height * 3);
  return {
    width,
    height,
    rgb,
    set(x, y, r, g, b) {
      const i = (y * width + x) * 3;
      rgb[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      rgb[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      rgb[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    },
  };
}
