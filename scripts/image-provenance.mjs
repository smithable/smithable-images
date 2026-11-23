import sharp from "sharp";

const IPTC_EXTENSION = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/";
const SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const TYPE = `<Iptc4xmpExt:DigitalSourceType rdf:resource="${SOURCE_TYPE}" />`;
const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:Iptc4xmpExt="${IPTC_EXTENSION}">
      ${TYPE}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

function hasStatement(xmp) {
  const packet = xmp?.toString("utf8") ?? "";
  return packet.includes(IPTC_EXTENSION) && packet.includes(TYPE);
}

export async function assertGeneratedWebp(input, name) {
  const { format, xmp } = await sharp(input).metadata();
  if (format !== "webp" || !hasStatement(xmp)) {
    throw new Error(`${name}: missing the generated-picture IPTC statement in WebP XMP`);
  }
}

export async function encodedPicture(output, generated, name) {
  const bytes = await (generated ? output.withXmp(XMP) : output).toBuffer();
  if (generated) await assertGeneratedWebp(bytes, name);
  return bytes;
}

// WebP RIFF metadata can be added without touching the compressed image chunks.
function chunk(name, data) {
  const result = Buffer.alloc(8 + data.length + (data.length % 2));
  result.write(name, 0, "ascii");
  result.writeUInt32LE(data.length, 4);
  data.copy(result, 8);
  return result;
}

export async function backfillGeneratedWebp(bytes, name) {
  const invalid = () => new Error(`${name}: invalid WebP container`);
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw invalid();
  }

  const parts = [];
  let extended;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw invalid();
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) throw invalid();
    if (type === "XMP ") {
      if (!hasStatement(bytes.subarray(offset + 8, offset + 8 + size))) {
        throw new Error(`${name}: existing XMP needs a manual provenance merge`);
      }
      await assertGeneratedWebp(bytes, name);
      return bytes;
    }
    if (type === "VP8X") {
      if (offset !== 12 || size !== 10) throw invalid();
      extended = Buffer.from(bytes.subarray(offset + 8, offset + 18));
    } else {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }

  if (!extended) {
    // A simple WebP gains the extended header required for XMP, with its original canvas.
    const { width, height, hasAlpha } = await sharp(bytes).metadata();
    extended = Buffer.alloc(10);
    if (hasAlpha) extended[0] |= 0x10;
    extended.writeUIntLE(width - 1, 4, 3);
    extended.writeUIntLE(height - 1, 7, 3);
  }
  extended[0] |= 0x04;
  const header = Buffer.from(bytes.subarray(0, 12));
  const result = Buffer.concat([header, chunk("VP8X", extended), ...parts, chunk("XMP ", Buffer.from(XMP))]);
  result.writeUInt32LE(result.length - 8, 4);
  await assertGeneratedWebp(result, name);
  return result;
}
