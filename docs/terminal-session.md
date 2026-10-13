# Sessão contínua do terminal

O painel **Terminal** e o botão **Executar** usam um shell/PTY interativo do
LunusDroid, aberto por `createTerminalSession`. A saída aparece enquanto o
programa está rodando, incluindo servidores que não terminam espontaneamente.
O painel usa [xterm.js](https://xtermjs.org/docs/api/terminal/classes/terminal/)
para interpretar as sequências VT100/XTerm.

O botão Executar continua usando o arquivo salvo em disco e pede confirmação.
A prévia de HTML permanece separada. Os métodos antigos dos plugins
(`runTerminalCommand`, `runTerminalCommandAsync` e `runCode`) mantêm seus
contratos de resultado em uma sessão de compatibilidade separada, para não
injetar marcadores ou comandos em um programa interativo em primeiro plano.
Arquivos são compartilhados, mas variáveis de ambiente e mudanças de diretório
dos plugins não alteram o shell do painel.

## Fluxo interativo

1. `openInteractiveTerminal(id, directory, rows, cols)` agenda a criação da
   sessão fora da UI. O diretório inicial recebe `cd` com proteção de aspas;
   entradas posteriores vão diretamente ao PTY, sem novo `cd` e sem marcadores.
2. `onOutput` decodifica UTF-8 incrementalmente e mantém até 256K unidades
   UTF-16 pendentes. A interface drena blocos de até 16K a cada 50 ms, ou logo
   após renderizar o bloco anterior quando ainda há dados. Não espera o comando
   terminar. Sob sobrecarga, o truncamento é informado visivelmente.
3. O teclado do xterm e o campo de entrada chamam `writeInteractiveTerminal`.
   Enter também pode enviar uma linha vazia a um programa. **Ctrl+C** envia o
   byte de interrupção ao PTY; seu efeito depende do programa ativo.
4. Alterações no tamanho do painel chamam `resizeInteractiveTerminal`. O
   histórico do xterm tem até 1000 linhas, com até 300 colunas e 200 linhas
   visíveis. A fila nativa de operações também é limitada; entradas recusadas
   produzem aviso.
5. **Encerrar sessão** chama `close()`; o **×** apenas oculta o painel. O fluxo
   interativo não tem timeout de dez minutos. Fechar o shell, desconectar o
   serviço ou destruir a Activity encerra o fluxo no cliente. O código de saída
   informado é o do shell; não é gerado um resultado JSON por comando digitado.

## Compatibilidade com plugins

Os métodos antigos continuam serializando um comando por vez, usando marcadores
para detectar o código de saída. A execução tem timeout de dez minutos e saída
retida limitada; servidores interativos devem ser iniciados pelo painel.
Nenhum dos caminhos usa `IDebianCommandService.execute`.

## Contrato AIDL

`IDebianTerminalSession` expõe `write(byte[])`, `resize(rows, cols)` e
`close()`. `IDebianTerminalCallback.onOutput(byte[])` pode ser chamado em
vários blocos e `onSessionClosed(exitCode)` sinaliza que não haverá mais saída.
Implementações devem manter esses métodos leves, pois são chamadas Binder.

## Último projeto

Ao escolher uma pasta pelo seletor de projetos, a URI recebe uma permissão
persistente do Android e é salva nas preferências locais. Na próxima abertura
do app, essa URI é validada e os arquivos são carregados automaticamente. Se a
permissão tiver sido removida pelo sistema, a referência salva é descartada e
nenhum projeto é aberto.

O menu **Arquivos → Salvar arquivo** grava o conteúdo atual diretamente na
pasta do projeto, preservando subpastas e criando diretórios ausentes.

Para árvores do armazenamento principal (`primary:`), o diretório do terminal
é convertido automaticamente: `primary:Projetos/App` vira
`/sdcard/Projetos/App`. URIs de outros provedores usam `/sdcard` como fallback.

## Limites do caminho de compatibilidade

- Só um comando pode aguardar resposta por vez; chamadas concorrentes recebem
  erro em vez de misturar a saída de dois comandos.
- Há timeout de dez minutos por execução. Ao atingir o limite, a sessão é
  encerrada para impedir que a saída de um comando atrasado contamine o próximo;
  uma nova sessão será criada na execução seguinte.
- O diretório de trabalho é aplicado a cada comando com `cd`, enquanto o
  ambiente e processos do shell são preservados.
- Caminhos relativos do arquivo mantêm suas subpastas (por exemplo,
  `src/main.py` vira `/sdcard/src/main.py`). O prefixo Android
  `/storage/emulated/0/` também é convertido automaticamente para `/sdcard/`.
- A saída é decodificada como UTF-8 e o marcador interno não aparece no JSON.

## Ciclo de vida

- **Segundo plano sem destruição:** `onPause`/`onStop` não fecham a sessão nem
  desfazem o vínculo. O cliente reutiliza o mesmo shell ao retornar, desde que
  o serviço e a sessão continuem disponíveis.
- **Rotação ou recriação:** a sessão pertence à instância da Activity.
  `onDestroy` invalida seus callbacks, libera qualquer comando pendente com
  erro, solicita `close()` e desvincula o serviço. A nova Activity cria outra
  sessão sob demanda; ambiente e processos da sessão anterior não são retomados.
  O AIDL atual não oferece identificação/retomada de sessão nem troca de callback.
- **Fechamento da Activity:** segue a mesma limpeza. Respostas assíncronas não
  são entregues ao WebView destruído; comandos também não podem ser iniciados
  nessa instância. Callbacks mantêm somente uma referência fraca à Activity e
  são validados pela geração da sessão, inclusive após timeout ou reconexão.
- **Processo morto ou serviço desconectado:** não há garantia de execução de
  `onDestroy`, fechamento remoto ou recuperação do shell. A interface sinaliza
  a desconexão quando recebe o callback; a próxima conexão cria uma nova sessão.

A reutilização das sessões ocorre dentro da mesma Activity e conexão. Não há promessa de persistência entre recriações ou mortes de processo.

## Verificação

`AsyncTerminalBridgeTest` passou no emulador Pixel_2 com Android 12/API 32 e
serviço AIDL simulado. Os testes cobrem reutilização em segundo plano, rotação real,
recriação via `ActivityScenario.recreate()`, fechamento, liberação do comando
pendente e rejeição de callbacks antigos. O fluxo interativo também testa saída
antes do encerramento, entrada adicional, Ctrl+C, resize, truncamento e UTF-8.
Um teste no WebView Android verifica a renderização dos logs no xterm e o envio
de entrada, Ctrl+C e encerramento pela bridge real do cliente.
Não valida a sobrevivência do shell
no serviço LunusDroid real nem após morte de processo.

O cliente tenta desvincular o serviço mesmo quando `bindService()` retorna
`false`, conforme a [documentação de serviços vinculados do Android](https://developer.android.com/develop/background-work/services/bound-services).
