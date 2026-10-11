/* Plugin de exemplo: linguagem JavaScript para o editor. */
CodeEditorAPI.addPlugin({
  id: "javascript-language",
  name: "JavaScript completo",
  startupCommands: ["node --version"],

  activate({ api, addLanguage, updateLanguage, addSnippets, registerCommand, addTopbarOption, runTerminalCommand }) {
    const update = updateLanguage || ((id, changes) => api.addLanguage({
      ...api.getLanguages().find((language) => language.id === id),
      ...changes,
      id,
    }, { replace: true }));
    const javascript = {
      id: "javascript",
      mimeType: "application/javascript",
      label: "JavaScript",
      badge: "JS",
      extensions: [".js", ".mjs", ".cjs"],
      lineComment: "//",
      blockComment: ["/*", "*/"],
      keywords: [
        "const", "let", "var", "function", "return", "if", "else", "for",
        "while", "class", "extends", "import", "export", "async", "await",
      ],
      literals: ["true", "false", "null", "undefined"],
      types: ["Array", "Object", "String", "Number", "Boolean", "Promise"],
    };
    if (api.getLanguages().some((language) => language.id === "javascript")) {
      update("javascript", javascript);
    } else {
      addLanguage(javascript);
    }

    addSnippets("javascript", [
      {
        label: "log",
        detail: "console.log",
        insertText: "console.log();",
        caretBack: 2,
        kind: "snippet",
      },
      {
        label: "async-function",
        detail: "Função assíncrona",
        insertText: "async function name() {\n    \n}",
        caretBack: 4,
        kind: "snippet",
      },
    ]);

    registerCommand("verificar-node", () =>
      runTerminalCommand("node --version"));

    addTopbarOption({
      id: "javascript-node-version",
      type: "button",
      label: "Node",
      icon: "JS",
      onClick: () => CodeEditorAPI.executePluginCommand(
        "javascript-language",
        "verificar-node",
      ),
    });
  },
});
