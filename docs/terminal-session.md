# Sessão contínua do terminal

O editor Android mantém uma sessão interativa com o serviço Debian do
LunusDroid. A sessão é criada sob demanda na primeira chamada a
`MainActivity.executeLunusDroidCommand` e reutilizada nas chamadas seguintes.
O botão **Executar** e o painel **Terminal** usam esse mesmo caminho; não há
mais execução one-shot via `IDebianCommandService.execute`.
O botão Executar não cria arquivo temporário: ele faz `cd` para a pasta do
projeto e executa o arquivo que já existe. Salve alterações pelo menu
**Arquivos → Salvar arquivo** antes de executar.

## Fluxo

1. `IDebianCommandService.createTerminalSession` inicia um shell/PTY e recebe
   um callback Binder.
2. O app envia `cd <diretório>`, o comando solicitado e um marcador único que
   imprime o exit code.
3. O callback acumula os bytes recebidos. Ao encontrar o marcador, libera a
   chamada e devolve o JSON esperado pelo WebView.
4. A sessão permanece aberta para a próxima execução e é fechada quando a
   Activity é destruída ou o serviço perde a conexão.

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

## Comportamento e limites

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

## Segundo plano

A Activity não fecha a sessão ao entrar em segundo plano nem durante uma
recriação de configuração; ao retornar ao app, o mesmo shell continua
disponível. O Android pode encerrar o processo inteiro sob pressão de memória
ou se o usuário remover o app das tarefas recentes. Nesses casos a sessão é
perdida e será criada novamente no próximo comando.
