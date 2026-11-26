// world-news-image-2511 — entry for make.fun news-image-20261125
//
// "Sum up 25 November's world news in one image."
// The editorial image is committed in this repository as entry.png.
// This program publishes it, byte-for-byte, to the output directory
// (MAKEFUN_OUTPUT_DIR, default /output) as entry.png.
//
// Guarantees:
//   - the published file is at most 1 MiB and at most 1024x1024 pixels
//     (the committed image already is: 1024x1024, 244055 bytes) —
//     both caps are enforced by parsing the image itself, not assumed;
//   - the publish is atomic: the bytes are written to a scratch file in
//     the same directory and renamed into place, so a reader never sees
//     a half-written entry, and the rename is verified to have consumed
//     the scratch file so the output directory holds only entry.png;
//   - a sha256 self-check proves the published bytes are identical to
//     the committed source; any mismatch fails loudly instead of
//     silently publishing a wrong file;
//   - the program is deterministic and uses no network, so two runs
//     write the same bytes.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1_048_576; // 1 MiB, the competition's image size cap
const SOURCE_NAME = "entry.png";
const OUTPUT_NAME = "entry.png";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, SOURCE_NAME);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const finalPath = join(outDir, OUTPUT_NAME);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Whole-image guard: the source must be a complete JPEG (SOI marker at
// the start, EOI marker at the end) or a complete PNG (8-byte signature
// at the start, IEND chunk at the end). A truncated or corrupt image
// fails here instead of being published.
function assertWholeImage(bytes: Buffer): void {
  const isJpeg =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9;
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const isPng =
    bytes.length >= 12 &&
    bytes.subarray(0, 8).equals(pngSignature) &&
    bytes.subarray(bytes.length - 12).includes(Buffer.from("IEND"));
  if (!isJpeg && !isPng) {
    throw new Error(
      "entry image is not a whole JPEG or PNG (missing start/end markers)",
    );
  }
}

// Dimension guard: the gate caps the image at 1024x1024 pixels.
// Parse the real dimensions out of the file itself — PNG IHDR, or the
// first JPEG start-of-frame marker — and refuse an oversize image
// instead of publishing it.
function imageDimensions(bytes: Buffer): { width: number; height: number } {
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(pngSignature)) {
    // IHDR: width and height are big-endian uint32 at offsets 16 and 20.
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk JPEG markers until a start-of-frame (0xc0-0xcf except 0xc4,
    // 0xc8, 0xcc); its payload holds height then width as uint16.
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        throw new Error("corrupt JPEG: expected marker prefix 0xff");
      }
      const marker = bytes[i + 1];
      const length = bytes.readUInt16BE(i + 2);
      if (length < 2 || i + 2 + length > bytes.length) {
        throw new Error("corrupt JPEG: marker length out of range");
      }
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        return {
          height: bytes.readUInt16BE(i + 5),
          width: bytes.readUInt16BE(i + 7),
        };
      }
      i += 2 + length;
    }
    throw new Error("corrupt JPEG: no start-of-frame marker found");
  }
  throw new Error("entry image is neither PNG nor JPEG");
}

const MAX_DIMENSION = 1024; // the competition's pixel cap, either side

const source = readFileSync(sourcePath);

if (source.length > MAX_BYTES) {
  throw new Error(
    `entry image is ${source.length} bytes, over the 1 MiB limit`,
  );
}
assertWholeImage(source);
const { width, height } = imageDimensions(source);
if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
  throw new Error(
    `entry image is ${width}x${height}, over the 1024x1024 limit`,
  );
}
const expectedHash = sha256(source);

// Publish atomically: write a scratch file in the same directory,
// then rename it into place.
mkdirSync(outDir, { recursive: true });
const scratchPath = join(outDir, `.${OUTPUT_NAME}.tmp-${process.pid}`);
writeFileSync(scratchPath, source);
renameSync(scratchPath, finalPath);

// The rename must have consumed the scratch file: a leftover scratch
// file would pollute the output directory, which the grader reads.
if (existsSync(scratchPath)) {
  throw new Error(`scratch file ${scratchPath} was not consumed by rename`);
}

// Self-check: the published bytes must hash-match the source, and the
// published file on disk must be within the size cap.
const published = readFileSync(finalPath);
const publishedSize = statSync(finalPath).size;
if (publishedSize > MAX_BYTES) {
  throw new Error(
    `published entry.png is ${publishedSize} bytes, over the 1 MiB limit`,
  );
}
if (published.length !== source.length || sha256(published) !== expectedHash) {
  throw new Error(
    "published entry.png does not match the source image (sha256 mismatch)",
  );
}

console.log(
  `wrote ${finalPath} (${published.length} bytes, sha256 ${expectedHash})`,
);
