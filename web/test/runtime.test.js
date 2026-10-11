import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeCommand, parseRunResult } from "../src/utils/runtime.js";

test("buildRuntimeCommand gera comando para JavaScript e Python no Debian", () => {
  assert.equal(
    buildRuntimeCommand("script.js", "javascript"),
    'unset PREFIX; node "/sdcard/script.js"',
  );

  assert.equal(
    buildRuntimeCommand("main.py", "python"),
    'unset PREFIX; python3 "/sdcard/main.py"',
  );
});

test("buildRuntimeCommand preserva subpastas e traduz a raiz compartilhada do Android", () => {
  assert.equal(
    buildRuntimeCommand("src/main.py", "python"),
    'unset PREFIX; python3 "/sdcard/src/main.py"',
  );
  assert.equal(
    buildRuntimeCommand("/storage/emulated/0/projeto/main.py", "python"),
    'unset PREFIX; python3 "/sdcard/projeto/main.py"',
  );
});

test("parseRunResult lê JSON do serviço LunusDroid e trata falha", () => {
  assert.deepEqual(
    parseRunResult('{"success":true,"exitCode":0,"output":"ok\\n"}'),
    { success: true, exitCode: 0, output: "ok\n", error: "" },
  );

  assert.deepEqual(parseRunResult("erro"), {
    success: false,
    exitCode: -1,
    output: "",
    error: "erro",
  });
});
