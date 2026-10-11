import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { buildRuntimeCommand, parseRunResult, quoteShellArgument } from "../src/utils/runtime.js";

function runShell(script) {
  const result = spawnSync("sh", ["-c", script], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.split("\0").slice(0, -1);
}

test("quoteShellArgument preserva argumentos literais no shell POSIX", () => {
  for (const value of ["", "a b", "a'b", 'a"b', "$HOME", "$(printf INJECTED)", "`printf INJECTED`", "a\\b", "a\nb", "; & | < > * ? # ( )"]) {
    assert.deepEqual(runShell(`printf '%s\\0' ${quoteShellArgument(value)}`), [value]);
  }
});

test("buildRuntimeCommand impede expansão e injeção em caminhos de todos os runtimes", () => {
  const runtimes = {
    javascript: ["node"], js: ["node"],
    python: ["python3"], py: ["python3"],
    bash: ["bash"], shell: ["bash"], sh: ["bash"],
    java: ["javac", "java"], unknown: ["sh"],
  };
  const stubs = ["node", "python3", "bash", "javac", "java", "sh"]
    .map((name) => `${name}() { printf '%s\\0' '${name}' "$#" "$@"; }`)
    .join("\n");
  const names = [
    "normal.java", "arquivo com espaços.java", "d'água.java", 'aspas".java',
    "$HOME.java", "$(printf INJECTED).java", "`printf INJECTED`.java",
    'x"; printf INJECTED; #.java', "x'; printf INJECTED; #.java",
    "a;b&c|d<>*?()#.java", "linha\nnova.java",
    "/storage/emulated/0/projeto com espaços/d'água.java",
  ];
  for (const [language, commands] of Object.entries(runtimes)) {
    for (const directory of ["/sdcard", "/sdcard/d'água/$(printf INJECTED)/`printf INJECTED`/\"projeto\""]) {
      for (const name of names) {
        const path = name.startsWith("/")
          ? name.replace(/^\/storage\/emulated\/0/, "/sdcard")
          : `${directory}/${name}`;
        const expected = commands.flatMap((command) => [
          command, "1", command === "java" ? path.replace(/\.java$/, "") : path,
        ]);
        assert.deepEqual(
          runShell(`${stubs}\n${buildRuntimeCommand(name, language, directory)}`),
          expected,
          `${language}: ${name}`,
        );
      }
    }
  }
});

test("buildRuntimeCommand gera comando para JavaScript e Python no Debian", () => {
  assert.equal(
    buildRuntimeCommand("script.js", "javascript"),
    "unset PREFIX; node '/sdcard/script.js'",
  );

  assert.equal(
    buildRuntimeCommand("main.py", "python"),
    "unset PREFIX; python3 '/sdcard/main.py'",
  );
});

test("buildRuntimeCommand preserva subpastas e traduz a raiz compartilhada do Android", () => {
  assert.equal(
    buildRuntimeCommand("src/main.py", "python"),
    "unset PREFIX; python3 '/sdcard/src/main.py'",
  );
  assert.equal(
    buildRuntimeCommand("/storage/emulated/0/projeto/main.py", "python"),
    "unset PREFIX; python3 '/sdcard/projeto/main.py'",
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
