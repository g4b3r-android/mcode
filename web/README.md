# Multiple-codes-interface

## Console de depuração no WebView

No servidor de desenvolvimento (`npm run dev`), o Eruda é carregado de forma assíncrona e exibe seu botão flutuante. Após carregar, fica disponível globalmente para controle pelo JavaScript. Ele não é incluído no bundle de produção nem no APK:

```js
eruda.show();
eruda.hide();
```

## Execução no LunusDroid

No Android, o botão **Executar** envia o arquivo para o serviço Debian por
`Android.runCode(payload)`. O payload contém `fileName`, `language`,
`content`, `workingDirectory` e `command`; a resposta é um JSON com
`success`, `exitCode`, `output` e `error`.

As execuções usam uma única sessão contínua de terminal enquanto a Activity
estiver aberta. Isso significa que variáveis exportadas, diretório atual e
processos em segundo plano podem ser reutilizados pela próxima execução. Cada
comando é delimitado internamente por um marcador aleatório, portanto a
resposta só é concluída quando o shell informa o exit code. A sessão é fechada
automaticamente em `onDestroy` ou quando o serviço Debian se desconecta.
Se uma execução ultrapassar dez minutos, a sessão também é encerrada e será
recriada na próxima execução.

O painel interativo pode ser aberto em **Arquivos → Abrir terminal**. Ele envia
cada linha pela mesma sessão usada pelo botão Executar; o diretório inicial é
`/sdcard`, a pasta compartilhada entre o editor e o Debian. Use `cd` para
entrar na subpasta do projeto e manter esse diretório nos comandos seguintes.
Ao executar arquivos em subpastas, o caminho relativo é preservado. Caminhos
que começam por `/storage/emulated/0/` são normalizados para `/sdcard/`.

O contrato AIDL fica em `app/src/main/aidl/com/g4b3r/lunusdroid/integration`:

- `IDebianCommandService.createTerminalSession(...)` cria o shell persistente;
- `IDebianTerminalSession.write(...)` envia bytes para stdin;
- `IDebianTerminalSession.resize(...)` ajusta o PTY;
- `IDebianTerminalSession.close()` encerra o processo;
- `IDebianTerminalCallback` entrega saída incremental e o encerramento.

Para integrar outro cliente, não faça chamadas bloqueantes no thread de UI e
trate a desconexão do serviço como encerramento da sessão.

## API do editor

Depois que a página carrega, a API fica disponível em `window.CodeEditorAPI`. Também é possível aguardar o evento de inicialização:

```js
window.addEventListener('code-editor:ready', ({ detail }) => {
  const editor = detail.api;
  console.log(editor.version);
});
```

### Barra de atalhos

A barra acima do teclado oferece atalhos básicos (`Tab`, `{}`, `""`, `()` e
`=>`). Plugins podem adicionar itens:

```js
CodeEditorAPI.addShortcut({ id: "pipe", label: "|", text: " | " });
CodeEditorAPI.removeShortcut("pipe");
CodeEditorAPI.getShortcuts();
```

O texto é inserido no campo que estiver focado (editor ou terminal).

Plugins podem validar o arquivo a cada alteração e devolver marcadores com
linha, coluna, mensagem e severidade. O editor atualiza automaticamente a
lista de problemas e a marcação no gutter:

```js
activate({ registerDiagnostics }) {
  registerDiagnostics((code, { language }) => {
    const errors = [];
    code.split("\\n").forEach((line, index) => {
      if (language.id === "css" && line.includes("color: red")) {
        errors.push({ line: index + 1, column: line.indexOf("color") + 1,
          message: "Evite vermelho direto no CSS.", severity: "warning" });
      }
    });
    return errors;
  });
}
```

O retorno de `registerDiagnostics()` é uma função de remoção, chamada pelo
plugin durante `deactivate` quando necessário.

Plugins podem verificar se o serviço Debian está conectado antes de executar
comandos:

```js
if (CodeEditorAPI.isTerminalAvailable()) {
  CodeEditorAPI.runTerminalCommand('echo terminal-ok');
}
```

Ao tentar executar sem o serviço disponível, o editor informa que o Terminal
Debian/LunusDroid precisa ser instalado e aberto. A mensagem aparece no painel
de saída, no histórico do terminal e como notificação Android.

### Plugins JavaScript

Plugins podem ser registrados por qualquer script carregado no WebView com
`CodeEditorAPI.addPlugin()`. A ativação ocorre imediatamente; comandos em
`startupCommands` são executados na sessão contínua do terminal antes de o
plugin ser considerado ativo.

```js
CodeEditorAPI.addPlugin({
  id: 'python-tools',
  name: 'Ferramentas Python',
  startupCommands: ['python3 --version'],
  activate({ addLanguage, runTerminalCommand, registerCommand, addTopbarOption }) {
    addLanguage({
      id: 'python-custom', label: 'Python+', badge: 'Py+', fileExt: '.pyx',
      lineComment: '#', keywords: ['async', 'await', 'match']
    }, { replace: false });
    registerCommand('formatar', (file, context) =>
      context.runTerminalCommand(`black "${file}"`));
    addTopbarOption({
      id: 'python-formatar', type: 'button', label: 'Formatar', icon: '✨',
      onClick: () => CodeEditorAPI.executePluginCommand('python-tools', 'formatar', 'main.py')
    });
  }
});
```

O contexto de `activate` expõe `addLanguage(config, options)`,
`updateLanguage(id, changes)`,
`addSnippets`, `addTopbarOption`, `registerCommand(id, handler)` e
`runTerminalCommand(command, directory)`. O handler de um comando recebe os
argumentos fornecidos por `executePluginCommand()` e o contexto como último
argumento, permitindo executar comandos a qualquer momento:

```js
await CodeEditorAPI.executePluginCommand('python-tools', 'formatar', 'app.py');
```

Use `removePlugin(id)` para executar a limpeza (`deactivate` ou a função
retornada por `activate`) e remover o plugin. Eventos disponíveis:
`code-editor:plugin-added`, `plugin-activated`, `plugin-error` e
`plugin-removed`. Plugins executam código com as permissões do WebView; só
instale scripts confiáveis.

Use **Arquivos → Adicionar plugin** para selecionar um ou vários arquivos
`.zip`. O importador extrai todos os arquivos `.js` dos pacotes e executa cada
plugin com acesso ao `CodeEditorAPI`. Cada script também é salvo como arquivo
na área interna de plugins do aplicativo.
O código-fonte importado é salvo no armazenamento local do WebView e os
plugins são restaurados automaticamente quando o app é aberto novamente.

Um exemplo pronto está em
`plugins/examples/javascript-language-plugin.zip`. Ele atualiza a linguagem
JavaScript, registra snippets e adiciona o botão `Node` à barra superior.

Em **Arquivos → Exportar plugins (.zip)**, o editor baixa `plugins.zip` com
`plugins.json` (manifesto, comandos e comandos de inicialização) e um arquivo
`plugins/<id>.js` com o código-fonte de cada plugin exportado.
No Android, a ação abre o seletor nativo para escolher a pasta e o nome do
arquivo; em um navegador comum, usa o download padrão.

### Adicionar uma linguagem

```js
CodeEditorAPI.addLanguage({
  id: 'javascript',
  label: 'JavaScript',
  badge: 'JS',
  color: '#f7df1e',
  extensions: ['.js', '.mjs'],
  lineComment: '//',
  blockComment: ['/*', '*/'],
  keywords: ['const', 'let', 'function', 'return', 'if', 'else'],
  literals: ['true', 'false', 'null', 'undefined'],
  types: ['Array', 'Object', 'String', 'Number', 'Promise']
});
```

Defina `mimeType` na linguagem para que o salvamento preserve a extensão no
armazenamento Android (por exemplo, `mimeType: 'application/javascript'`).
Essa informação também pode ser alterada por plugins com `updateLanguage()`.

Uma linguagem também pode fornecer `lint(code, context)`, retornando itens com `line`, `column`, `message` e `severity` (`error` ou `warning`). Use `{ replace: true }` como segundo argumento de `addLanguage` para substituir uma definição existente.

### Adicionar snippets

```js
CodeEditorAPI.addSnippets('javascript', [
  {
    label: 'log',
    detail: 'Console log',
    insertText: 'console.log();',
    caretBack: 2,
    kind: 'snippet'
  }
]);
```

O terceiro argumento aceita `{ replace: true }`. Os tipos de sugestão aceitos são `snippet`, `function`, `method`, `property` e `text`.

### Gerenciar arquivos

```js
CodeEditorAPI.addFile({
  name: 'app.js',
  language: 'javascript',
  content: 'console.log("Olá");',
  open: true
});

CodeEditorAPI.addFiles([
  { name: 'utils.js', content: 'export const value = 1;' },
  { name: 'index.html', content: '<h1>Projeto</h1>' }
], { openLast: true });

CodeEditorAPI.updateFile('app.js', { content: 'console.log("Atualizado");' });
CodeEditorAPI.openFile('app.js');
CodeEditorAPI.getFile('app.js');
CodeEditorAPI.getFiles();
CodeEditorAPI.getActiveFile();
CodeEditorAPI.removeFile('app.js');
```

`addFile` aceita `overwrite: true` para atualizar um arquivo existente.

### Adicionar opções à barra superior

Use `addTopbarOption()` para criar um botão:

```js
CodeEditorAPI.addTopbarOption({
  id: 'salvar',
  type: 'button',
  label: 'Salvar',
  icon: '💾',
  onClick({ activeFile }) {
    console.log('Salvar', activeFile);
  }
});
```

Ou um menu com várias ações:

```js
CodeEditorAPI.addTopbarOption({
  id: 'ferramentas',
  type: 'menu',
  label: 'Ferramentas',
  icon: '⋮',
  items: [
    {
      id: 'formatar',
      label: 'Formatar código',
      icon: '✨',
      onClick({ activeFile, api }) {
        console.log('Formatar', activeFile, api);
      }
    },
    { id: 'configurar', label: 'Configurações', disabled: true }
  ]
});
```

Quando `icon` é informado, somente o ícone é exibido por padrão; use `showLabel: true` para mostrar também o texto. As opções podem ser consultadas ou removidas com `getTopbarOptions()` e `removeTopbarOption(id)`. Para substituir uma opção existente, passe `{ replace: true }` como segundo argumento de `addTopbarOption()`.

### Renderizar HTML

```js
CodeEditorAPI.addFile('pagina.html', '<h1>Preview</h1>');
CodeEditorAPI.renderHtml({ file: 'pagina.html' });

// Ou renderize uma string diretamente:
CodeEditorAPI.renderHtml({
  title: 'Componente',
  html: '<button onclick="this.textContent = `OK`">Clique</button>'
});

CodeEditorAPI.closePreview();
```

O preview usa um `iframe` isolado com `sandbox`. Arquivos `.html` também são renderizados pelo botão Executar.

Eventos disponíveis: `code-editor:language-added`, `code-editor:snippets-added`, `code-editor:file-added`, `code-editor:file-updated`, `code-editor:file-opened`, `code-editor:file-removed`, `code-editor:topbar-option-added`, `code-editor:topbar-option-removed`, `code-editor:topbar-action`, `code-editor:html-rendered` e `code-editor:preview-closed`.

## Testes

Para gerar o build e executar o teste E2E da API:

```bash
npm run build:test
```

`npm test` executa o mesmo pipeline.

## Build Android e projetos locais

Após instalar as dependências com `npm ci` nesta pasta, o build Android executa
`npm run build` automaticamente e gera os assets dentro de `app/build/`.
Não é necessário copiar `dist` para `app/src/main/assets`. O build web independente
continua usando `web/dist`, que é limpo a cada execução. O Eruda é carregado apenas
no servidor de desenvolvimento (`npm run dev`), não nos bundles de produção.

No Android, a abertura de um projeto lista os arquivos em segundo plano, ignorando
`node_modules`, `.git`, `.gradle`, `build` e `dist`. Selecione um arquivo na lista
para carregar seu conteúdo. O editor aceita texto UTF-8 de até 2 MiB por arquivo;
conteúdo binário ou maior que esse limite exibe uma mensagem e não é aberto.

`CodeEditorAPI.getFiles()` retorna a lista sem ler os conteúdos pendentes
(`loaded: false`). Use `getFile(nome)`, `openFile(nome)` ou `renderHtml({ file: nome })`
para carregar um arquivo específico. A leitura individual ocorre na thread da
ponte Android; a chamada JavaScript aguarda esse resultado. Arquivos já carregados
permanecem em memória, preservando edições até a troca de projeto.
