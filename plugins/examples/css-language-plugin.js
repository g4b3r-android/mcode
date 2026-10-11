/* Plugin de exemplo: linguagem CSS para o editor. */
CodeEditorAPI.addPlugin({
  id: "css-language",
  name: "CSS completo",
  startupCommands: [],

  activate({ api, addLanguage, updateLanguage, addSnippets, registerCommand, addTopbarOption, runTerminalCommand, registerDiagnostics }) {
    const css = {
      id: "css",
      label: "CSS",
      badge: "CSS",
      mimeType: "text/css",
      extensions: [".css", ".scss", ".sass"],
      lineComment: "//",
      blockComment: ["/*", "*/"],
      keywords: ["@media", "@import", "@font-face", "@keyframes", "display", "position", "color", "background", "margin", "padding", "width", "height", "font-size"],
      literals: ["inherit", "initial", "none", "auto", "transparent"],
      types: ["px", "em", "rem", "%", "vh", "vw", "flex", "grid"],
    };
    if (api.getLanguages().some((language) => language.id === "css")) {
      (updateLanguage || ((id, changes) => api.addLanguage({ ...api.getLanguages().find((language) => language.id === id), ...changes, id }, { replace: true })))("css", css);
    } else {
      addLanguage(css);
    }

    addSnippets("css", [
      { label: "flex", detail: "Flexbox centralizado", insertText: "display: flex;\njustify-content: center;\nalign-items: center;", kind: "snippet" },
      { label: "media", detail: "Media query", insertText: "@media (max-width: 768px) {\n    \n}", caretBack: 4, kind: "snippet" },
      { label: "var", detail: "Variável CSS", insertText: "var(--name)", caretBack: 6, kind: "snippet" },
    ]);

    registerDiagnostics((code, { language }) => {
      if (language.id !== "css") return [];
      const problems = [];
      let depth = 0;
      code.split("\n").forEach((line, index) => {
        depth += (line.match(/{/g) || []).length;
        depth -= (line.match(/}/g) || []).length;
        if (/;\s*}/.test(line) === false && /:\s*[^;{}]+\s*}/.test(line)) {
          problems.push({ line: index + 1, column: line.indexOf("}") + 1, message: "Declaração CSS sem ponto e vírgula.", severity: "warning" });
        }
        if (depth < 0) {
          problems.push({ line: index + 1, column: 1, message: "Chave de fechamento sem abertura.", severity: "error" });
          depth = 0;
        }
      });
      if (depth > 0) problems.push({ line: code.split("\n").length, column: 1, message: "Bloco CSS não foi fechado.", severity: "error" });
      return problems;
    });

    registerCommand("verificar-css", () => runTerminalCommand("command -v node >/dev/null && echo 'CSS pronto para ferramentas Node' || echo 'CSS carregado'"));
    addTopbarOption({
      id: "css-check",
      type: "button",
      label: "CSS",
      icon: "#",
      onClick: () => CodeEditorAPI.executePluginCommand("css-language", "verificar-css"),
    });
  },
});
