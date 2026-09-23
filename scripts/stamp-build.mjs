#!/usr/bin/env node
// Prints lib/build.mjs as it should read for this checkout: the version and commit baked
// in, for an image that carries no .git of its own. Dockerfile.sea's first stage runs this
// and copies the output over lib/build.mjs in the image - see that file for why the sea
// cannot simply read them at start-up.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildInfo } from '../lib/buildinfo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = readBuildInfo(root);
process.stdout.write(`// Stamped by scripts/stamp-build.mjs when this image was built.\nexport default ${JSON.stringify(b)};\n`);
