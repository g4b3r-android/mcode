import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { DEFAULT_ZIP_LIMITS, readPluginZip } from "../src/plugins/zip-reader.js";

function archive(entries = [{ name: "plugin.js", text: "window.installed = true;" }], comment = "") {
  const localRecords = [], centralRecords = [], locals = [], centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.text || "");
    const method = entry.method || 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const extra = Buffer.from(entry.extra || []);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(entry.version ?? 20, 4);
    local.writeUInt16LE(entry.flags || 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    local.copy(central, 6, 4, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(entry.attributes || 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(offset);
    localRecords.push(local, name, extra, compressed);
    centralRecords.push(central, name, extra);
    offset += local.length + name.length + extra.length + compressed.length;
  }
  let position = offset;
  for (let index = 0; index < centralRecords.length; index += 3) {
    centrals.push(position);
    position += centralRecords[index].length + centralRecords[index + 1].length + centralRecords[index + 2].length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(position - offset, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return { bytes: Buffer.concat([...localRecords, ...centralRecords, end, Buffer.from(comment)]), locals, centrals, end: position };
}

const read = (bytes, limits) => readPluginZip(new Blob([bytes]), limits);

test("lê ZIP armazenado e deflate, diretórios, UTF-8 e comentário", async () => {
  const { bytes } = archive([
    { name: "plugins/", attributes: 0x41ed0010 },
    { name: "plugins/ação.js", text: "const ação = 'olá';", flags: 0x800 },
    { name: "plugins/compressed.js", text: "// conteúdo\n".repeat(100), method: 8, flags: 2 },
    { name: "plugins.json", text: "[]", extra: [0x55, 0x54, 1, 0, 0] },
  ], "comentário");
  const files = await read(bytes);
  assert.deepEqual(files.map(({ name }) => name), ["plugins/ação.js", "plugins/compressed.js", "plugins.json"]);
  assert.equal(new TextDecoder().decode(files[0].data), "const ação = 'olá';");
  assert.equal(new TextDecoder().decode(files[1].data), "// conteúdo\n".repeat(100));
  assert.deepEqual(await read(archive([]).bytes), []);
});

test("recusa arquivo grande antes de ler e valida limites configuráveis", async () => {
  let accessed = false;
  await assert.rejects(readPluginZip({ size: DEFAULT_ZIP_LIMITS.maxArchiveBytes + 1,
    arrayBuffer() { accessed = true; throw new Error("não deve ler"); } }), /limite/);
  assert.equal(accessed, false);
  const { bytes } = archive([{ name: "a.js", text: "1234" }, { name: "b.js", text: "5678" }]);
  await assert.rejects(read(bytes, { maxEntries: 1 }), /entradas/);
  await assert.rejects(read(bytes, { maxEntryBytes: 3 }), /expandidos/);
  await assert.rejects(read(bytes, { maxTotalBytes: 7 }), /expandidos/);
  await assert.rejects(read(bytes, { maxArchiveBytes: bytes.length - 1 }), /limite/);
  assert.equal((await read(bytes, { maxArchiveBytes: bytes.length, maxEntries: 2, maxEntryBytes: 4, maxTotalBytes: 8 })).length, 2);
  for (const value of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(read(bytes, { maxEntryBytes: value }), /limite/);
  }
  await assert.rejects(read(archive([{ name: "a".repeat(1025) }]).bytes), /nome.*limite/);
  await assert.rejects(read(archive([{ name: "a/".repeat(32) + "b.js" }]).bytes), /profundidade/);
});

test("recusa todos os truncamentos e bytes anexados", async () => {
  const { bytes } = archive();
  for (let end = 0; end < bytes.length; end++) await assert.rejects(read(bytes.subarray(0, end)));
  await assert.rejects(read(Buffer.concat([bytes, Buffer.from("extra")])));
});

test("recusa caminhos inseguros, nomes inválidos, duplicados e conflitos", async () => {
  for (const name of ["", "/a.js", "../a.js", "x/../a.js", "./a.js", "a//b.js", "a/ /b.js",
    "C:/a.js", "a\\b.js", "a\0.js", "a\n.js", "a/./b.js"]) {
    await assert.rejects(read(archive([{ name }]).bytes), /nome|caminho/);
  }
  for (const names of [["a.js", "a.js"], ["é.js", "e\u0301.js"], ["folder", "folder/a.js"], ["folder", "folder/"]]) {
    await assert.rejects(read(archive(names.map(name => ({ name }))).bytes), /duplicados|diretório/);
  }
  const { bytes, centrals } = archive();
  bytes[30] = bytes[centrals[0] + 46] = 0xff;
  await assert.rejects(read(bytes), /encoded data|encoding/i);
});

test("recusa criptografia, descriptors, ZIP64, métodos e tipos especiais", async () => {
  for (const settings of [
    { flags: 1 }, { flags: 8 }, { flags: 0x40 }, { method: 12 }, { version: 45 },
    { extra: [1, 0, 0, 0] }, { extra: [1, 0x99, 0, 0] },
    { attributes: 0xa1ff0000 }, { attributes: 0x21ff0000 }, { attributes: 0x10 },
  ]) await assert.rejects(read(archive([{ name: "a.js", ...settings }]).bytes), /não suportado|divergente/);
  const directory = archive([{ name: "folder/", text: "unexpected" }]);
  await assert.rejects(read(directory.bytes), /diretório com conteúdo/);
});

test("valida limites dos cabeçalhos, offsets e correspondência local/central", async () => {
  const mutations = [
    ({ bytes, end }) => bytes.writeUInt16LE(1, end + 4),
    ({ bytes, end }) => bytes.writeUInt16LE(0xffff, end + 8) && bytes.writeUInt16LE(0xffff, end + 10),
    ({ bytes, end }) => bytes.writeUInt32LE(0xffffffff, end + 16),
    ({ bytes, end }) => bytes.writeUInt32LE(1, end + 12),
    ({ bytes, centrals }) => bytes.writeUInt16LE(0xffff, centrals[0] + 28),
    ({ bytes, centrals }) => bytes.writeUInt16LE(0xffff, centrals[0] + 32),
    ({ bytes, centrals }) => bytes.writeUInt32LE(1, centrals[0] + 42),
    ({ bytes, centrals }) => bytes.writeUInt32LE(0, centrals[0]),
    ({ bytes, centrals }) => bytes[centrals[0] + 46] ^= 1,
    ({ bytes }) => bytes.writeUInt32LE(0, 0),
    ({ bytes }) => bytes.writeUInt16LE(0xffff, 28),
    ({ bytes }) => bytes.writeUInt32LE(0xffffffff, 18),
    ({ bytes }) => bytes.writeUInt16LE(8, 6),
  ];
  for (const mutate of mutations) {
    const fixture = archive();
    mutate(fixture);
    await assert.rejects(read(fixture.bytes));
  }
  for (const extra of [[0], [0x55, 0x54, 20, 0, 0]]) {
    await assert.rejects(read(archive([{ name: "a.js", extra }]).bytes), /truncados/);
  }
  const overlap = archive([{ name: "a" }, { name: "b" }]);
  overlap.bytes.writeUInt32LE(0, overlap.centrals[1] + 42);
  await assert.rejects(read(overlap.bytes), /sobrepostas/);
});

test("recusa CRC incorreto inclusive em entrada não JavaScript posterior", async () => {
  const fixture = archive([{ name: "first.js", text: "window.ran = true;" }, { name: "asset.txt", text: "data" }]);
  fixture.bytes[fixture.centrals[0] - 1] ^= 1;
  await assert.rejects(read(fixture.bytes), /CRC/);
});

test("limita expansão real mesmo com tamanhos declarados falsos", async () => {
  const bomb = archive([{ name: "bomb.js", text: "x".repeat(1024 * 1024), method: 8, declaredSize: 8 }]);
  await assert.rejects(read(bomb.bytes, { maxEntryBytes: 8, maxTotalBytes: 8 }), /expansão/);
  await assert.rejects(read(archive([{ name: "short.js", text: "x", method: 8, declaredSize: 2 }]).bytes), /expandido divergente/);
  const truncated = archive([{ name: "bad.js", text: "content", method: 8 }]);
  truncated.bytes.fill(0xff, 30 + Buffer.byteLength("bad.js"), truncated.centrals[0]);
  await assert.rejects(read(truncated.bytes));
});

test("cancela o leitor de expansão assim que o limite é ultrapassado", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "DecompressionStream", function () {
    return {
      writable: new WritableStream(),
      readable: new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(100)); },
        cancel() { cancelled = true; },
      }),
    };
  });
  await assert.rejects(read(archive([{ name: "a.js", text: "a", method: 8 }]).bytes), /expansão/);
  assert.equal(cancelled, true);
});
