// Store-only UTF-8 ZIP. Binary layout follows the supplied Café Brief prototype.
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = byte & 1 ? 0xedb88320 ^ (byte >>> 1) : byte >>> 1;
  return byte;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function makeZip(files) {
  const encode = new TextEncoder();
  const local = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of files) {
    const filename = encode.encode(name);
    const crc = crc32(data);
    const entry = new DataView(new ArrayBuffer(30));
    entry.setUint32(0, 0x04034b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 0x0800, true);
    entry.setUint32(14, crc, true);
    entry.setUint32(18, data.length, true);
    entry.setUint32(22, data.length, true);
    entry.setUint16(26, filename.length, true);
    local.push(entry.buffer, filename, data);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, data.length, true);
    record.setUint32(24, data.length, true);
    record.setUint16(28, filename.length, true);
    record.setUint32(42, offset, true);
    directory.push(record.buffer, filename);
    offset += entry.byteLength + filename.byteLength + data.byteLength;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directory.reduce((total, part) => total + part.byteLength, 0), true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...directory, end.buffer], { type: 'application/zip' });
}
