# Compress what the server sends

`serve.mjs` sends everything uncompressed. `sendFile` writes a `Content-Type` and a
`Cache-Control` and streams the bytes; there is no `Content-Encoding` anywhere in the
file.

Measured on the current island:

| File | Sent | Gzipped |
|---|---|---|
| `web/vendor/three.module.js` | 1284 kB | 260 kB |
| `data/village.json` | 525 kB | 83 kB |
| `web/js/main.js` | 57 kB | 16 kB |

That is roughly 1.5 MB of the first load turned into 360 kB, and `village.json` alone
saves 440 kB on every reload — it is fetched again on every live update.

## Work

In `sendFile`, when the request's `Accept-Encoding` includes gzip and the type is
compressible (`.json`, `.js`, `.css`, `.html`, `.svg`, `.ndjson`), pipe through
`zlib.createGzip()` and set `Content-Encoding: gzip`. Drop `Content-Length`, or compress
to a buffer first and set it correctly — a wrong length breaks the response.

Two things not to compress: anything already compressed (`.png`, `.woff2`, the icons),
and the SSE stream at `/api/events`, which needs to flush per event rather than fill a
compression buffer.

Worth caching the compressed vendor bundle in memory: it never changes between restarts,
and gzipping 1.3 MB on every cold load is wasted work.

Small and self-contained, and a bigger win for how the island feels to open than anything
in the hamlet work.
