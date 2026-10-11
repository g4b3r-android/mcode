import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "path";
import { defineConfigDefault, removeModuleType } from "./vite.default.js";




export default defineConfig(({ command }) => {
  // Criamos uma lista base de plugins
  const plugins = [
    {
      name: "alterar-modulo-js",
      // O hook transform recebe o código do arquivo (code) e o caminho dele (id)
      transform(code, id) {
        // Filtre pelo nome do arquivo ou extensão para não pesar o build
        // Substitua 'meu-modulo.js' pelo nome real do seu arquivo javascript
        if (id.includes("main.js")) {
          // Substitui o valor desejado dentro do código JavaScript
          // Exemplo: alterando a string "index.html" por "player"
          let  codigoModificado = code.replace(
            /"http:\/\/127.0.0.1:5000\/"/g,
            '"../"',
          );
                codigoModificado = codigoModificado.replace("sw.js", "sw-js")
          return {
            code: codigoModificado,
            map: null, // Mantém o source map nulo se não estiver editando mapas de depuração
          };
        }
      },
    },
    viteSingleFile(), // Continua no final para empacotar tudo modificado
  ];

  // Só adiciona o "removeModuleType" se for o comando de build
  if (command === 'build') {
    plugins.push(removeModuleType());
  }
  return defineConfigDefault("index.html", plugins, resolve);

});
