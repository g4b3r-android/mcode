
export function defineConfigDefault(htmlFile, plugins, resolve) {
  return {
    plugins: plugins,
    esbuild: {
      // Evita template strings no HTML final. Alguns WebViews rejeitam as
      // strings multilinha geradas pelo minificador ao carregar android_asset.
      supported: { "template-literal": false },
    },
    // ... restante da sua config
    build: {
      // 10240 bytes = 100KB (Imagens menores que isso viram binário automaticamente)
      assetsInlineLimit: 10485760, // 10MB

      emptyOutDir: true,

      target: "chrome61",
      minify: "esbuild",
      modulePreload: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, htmlFile),
        },
        output: {
          format: "iife",
          inlineDynamicImports: true,
        },
      },
    },
  };
}


export function removeModuleType() {
  return {
    name: "remove-module-type",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const [fileName, file] of Object.entries(bundle)) {
        if (file.type !== "asset" || !/\.html?$/.test(fileName)) continue;

        let output = String(file.source).replace(/type="module"/g, "").replace(/crossorigin/g, "");
        const inlineScript = output.match(/<script\s*>([\s\S]*?)<\/script>/i);
        if (!inlineScript) continue;

        output = output.replace(inlineScript[0], "");
        const closingBodyIndex = output.toLowerCase().lastIndexOf("</body>");
        if (closingBodyIndex === -1) continue;
        file.source = `${output.slice(0, closingBodyIndex)}${inlineScript[0]}\n${output.slice(closingBodyIndex)}`;
      }
    },
  };
}
