// Supported ZIP subset: one disk, stored/deflate entries, no encryption or data descriptors.
// Local and central records must agree; ZIP64 and prepended/appended payloads are rejected.
export const DEFAULT_ZIP_LIMITS = Object.freeze({
  maxArchiveBytes: 8 * 1024 * 1024,
  maxEntries: 128,
  maxEntryBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxNameBytes: 1024,
  maxPathDepth: 32,
});

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function requireZip(condition, message) {
  if (!condition) throw new Error(`ZIP inválido ou não suportado: ${message}`);
}

function validateName(name, maxDepth) {
  requireZip(name && !/[\\:\u0000-\u001f\u007f-\u009f]/u.test(name), "nome de entrada inseguro.");
  const path = name.endsWith("/") ? name.slice(0, -1) : name;
  const parts = path.split("/");
  requireZip(parts.length <= maxDepth, "profundidade máxima do caminho excedida.");
  requireZip(parts.every((part) => part.trim() && part !== "." && part !== ".."), "caminho inseguro.");
  return path.normalize("NFC");
}

async function expandEntry(compressed, entry) {
  if (entry.method === 0) return compressed;
  requireZip(typeof DecompressionStream === "function", "este WebView não suporta ZIP compactado.");
  const reader = new Blob([compressed]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  // The declared length has already passed both entry and total budgets.
  const output = new Uint8Array(entry.size);
  let written = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      requireZip(value.byteLength <= output.length - written, "expansão excede o tamanho permitido.");
      output.set(value, written);
      written += value.byteLength;
    }
    requireZip(written === entry.size, "tamanho expandido divergente.");
    return output;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readPluginZip(file, options = {}) {
  const limits = { ...DEFAULT_ZIP_LIMITS, ...options };
  for (const key of Object.keys(DEFAULT_ZIP_LIMITS)) {
    requireZip(Number.isSafeInteger(limits[key]) && limits[key] > 0, `limite ${key} inválido.`);
  }
  requireZip(Number.isSafeInteger(file.size) && file.size <= limits.maxArchiveBytes && file.size >= 22,
    "tamanho do arquivo fora do limite.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  requireZip(bytes.length === file.size && bytes.length <= limits.maxArchiveBytes, "tamanho do arquivo divergente.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const bounds = (start, length, end = bytes.length) => {
    requireZip(start >= 0 && length >= 0 && start + length <= end, "cabeçalho ou dados truncados.");
  };
  const checkExtra = (start, length) => {
    const end = start + length;
    while (start < end) {
      bounds(start, 4, end);
      const id = view.getUint16(start, true);
      const size = view.getUint16(start + 2, true);
      requireZip(id !== 0x0001 && id !== 0x9901, "ZIP64 ou criptografia não suportados.");
      bounds(start + 4, size, end);
      start += 4 + size;
    }
  };

  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 &&
        offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      end = offset;
      break;
    }
  }
  requireZip(end >= 0, "diretório central ausente ou final truncado.");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  requireZip(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0 &&
    view.getUint16(end + 8, true) === count, "arquivos divididos em volumes não são suportados.");
  requireZip(count !== 0xffff && centralSize !== 0xffffffff && centralStart !== 0xffffffff, "ZIP64 não suportado.");
  requireZip(count <= limits.maxEntries, "número máximo de entradas excedido.");
  requireZip(centralStart + centralSize === end, "limites do diretório central divergentes.");

  const entries = [];
  const paths = new Map();
  let offset = centralStart;
  let total = 0;
  for (let index = 0; index < count; index++) {
    bounds(offset, 46, end);
    requireZip(view.getUint32(offset, true) === 0x02014b50, "cabeçalho central inválido.");
    const version = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    requireZip(nameSize <= limits.maxNameBytes, "nome de entrada excede o limite.");
    requireZip(version <= 20 && (method === 0 || method === 8) &&
      (flags & ~(method === 8 ? 0x0806 : 0x0800)) === 0, "método, versão ou flags não suportados.");
    requireZip(view.getUint16(offset + 34, true) === 0, "entrada em outro volume.");
    requireZip(size !== 0xffffffff && compressedSize !== 0xffffffff && localOffset !== 0xffffffff, "ZIP64 não suportado.");
    requireZip(size <= limits.maxEntryBytes && size <= limits.maxTotalBytes - total, "limite de dados expandidos excedido.");
    total += size;
    requireZip(method !== 0 || compressedSize === size, "tamanho de entrada sem compressão divergente.");
    bounds(offset + 46, nameSize + extraSize + commentSize, end);
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameSize);
    const name = decoder.decode(rawName);
    const path = validateName(name, limits.maxPathDepth);
    const directory = name.endsWith("/");
    requireZip(!paths.has(path), "nomes de entradas duplicados.");
    const attributes = view.getUint32(offset + 38, true);
    const unixType = view.getUint16(offset + 4, true) >>> 8 === 3 ? (attributes >>> 16) & 0xf000 : 0;
    requireZip(unixType === 0 || unixType === (directory ? 0x4000 : 0x8000), "links ou tipos especiais não suportados.");
    requireZip(!(attributes & 0x10) || directory, "atributo de diretório divergente.");
    requireZip(!directory || size === 0, "diretório com conteúdo.");
    paths.set(path, directory);
    checkExtra(offset + 46 + nameSize, extraSize);
    entries.push({ name, path, directory, rawName, version, flags, method, crc, compressedSize, size, localOffset });
    offset += 46 + nameSize + extraSize + commentSize;
  }
  requireZip(offset === end, "contagem ou tamanho do diretório central divergente.");
  for (const { path } of entries) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      requireZip(paths.get(parts.slice(0, index).join("/")) !== false, "arquivo usado como diretório.");
    }
  }

  // Validate every local record before expanding any entry. Reject gaps and overlaps.
  let localEnd = 0;
  for (const entry of [...entries].sort((a, b) => a.localOffset - b.localOffset)) {
    const local = entry.localOffset;
    requireZip(local === localEnd, "entradas sobrepostas ou dados extras.");
    bounds(local, 30, centralStart);
    requireZip(view.getUint32(local, true) === 0x04034b50 &&
      view.getUint16(local + 4, true) === entry.version &&
      view.getUint16(local + 6, true) === entry.flags &&
      view.getUint16(local + 8, true) === entry.method &&
      view.getUint32(local + 14, true) === entry.crc &&
      view.getUint32(local + 18, true) === entry.compressedSize &&
      view.getUint32(local + 22, true) === entry.size, "cabeçalhos local e central divergentes.");
    const nameSize = view.getUint16(local + 26, true);
    const extraSize = view.getUint16(local + 28, true);
    bounds(local + 30, nameSize + extraSize + entry.compressedSize, centralStart);
    requireZip(nameSize === entry.rawName.length && entry.rawName.every((byte, index) => bytes[local + 30 + index] === byte),
      "nomes local e central divergentes.");
    checkExtra(local + 30 + nameSize, extraSize);
    entry.dataStart = local + 30 + nameSize + extraSize;
    localEnd = entry.dataStart + entry.compressedSize;
  }
  requireZip(localEnd === centralStart, "dados não indexados antes do diretório central.");

  const files = [];
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    const data = await expandEntry(compressed, entry);
    requireZip(crc32(data) === entry.crc, "CRC divergente; entrada corrompida.");
    if (!entry.directory) files.push({ name: entry.name, data });
  }
  return files;
}
