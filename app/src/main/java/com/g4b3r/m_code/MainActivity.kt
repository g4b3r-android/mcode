package com.g4b3r.m_code

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.provider.DocumentsContract
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.RemoteException
import android.util.Log
import android.util.Base64
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Toast
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext
import androidx.documentfile.provider.DocumentFile
import com.g4b3r.lunusdroid.integration.IDebianCommandService
import com.g4b3r.lunusdroid.integration.IDebianTerminalCallback
import com.g4b3r.lunusdroid.integration.IDebianTerminalSession
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    internal companion object {
        const val EDITOR_URL = "file:///android_asset/web/index.html"

        fun isTrustedEditorUrl(url: String?): Boolean =
            url?.substringBefore('#') == EDITOR_URL

        fun isAllowedEditorNavigation(url: String, isMainFrame: Boolean): Boolean =
            if (isMainFrame) isTrustedEditorUrl(url)
            else url == "about:blank" || url == "about:srcdoc"
    }
    private val projectPrefs by lazy { getSharedPreferences("project_state", Context.MODE_PRIVATE) }
    private val lastProjectUriKey = "last_project_uri"
    private lateinit var myWebView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingZipBytes: ByteArray? = null
    private val pluginZipSaveLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        val bytes = pendingZipBytes
        pendingZipBytes = null
        if (uri != null && bytes != null) contentResolver.openOutputStream(uri, "w")?.use {
            it.write(bytes)
            it.flush()
        }
        if (uri != null && bytes != null) {
            Toast.makeText(this, "Plugins exportados (${bytes.size} bytes)", Toast.LENGTH_SHORT).show()
        }
    }
    private val pluginZipPickerLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        fileChooserCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        fileChooserCallback = null
    }
    @Volatile private var currentProjectUri: Uri? = null
    private var projectLoadJob: Job? = null
    private data class ProjectIndex(val root: Uri, val files: Map<String, Uri>)
    @Volatile private var projectIndex: ProjectIndex? = null
    private val ignoredProjectDirectories = setOf("node_modules", ".git", ".gradle", "build", "dist")
    @Volatile private var commandService: IDebianCommandService? = null
    private var terminalSession: IDebianTerminalSession? = null
    private val terminalLock = Any()
    private var pendingTerminalCommand: PendingTerminalCommand? = null

    private class PendingTerminalCommand(val marker: String, val startMarker: String) {
        val output = StringBuilder()
        val completed = CountDownLatch(1)
        var exitCode: Int? = null
        var error: String? = null
    }

    private val terminalCallback = object : IDebianTerminalCallback.Stub() {
        override fun onOutput(data: ByteArray?) {
            if (data == null || data.isEmpty()) return
            synchronized(terminalLock) {
                val pending = pendingTerminalCommand ?: return
                if (pending.exitCode != null) return
                pending.output.append(String(data, StandardCharsets.UTF_8))
                val completion = findTerminalCompletion(pending.output, pending.marker) ?: return
                pending.exitCode = completion.exitCode
                pending.output.delete(completion.markerStart, pending.output.length)
                pending.completed.countDown()
            }
        }

        override fun onSessionClosed(exitCode: Int) {
            synchronized(terminalLock) {
                terminalSession = null
                pendingTerminalCommand?.let {
                    it.error = "Sessão do terminal encerrada (exit code $exitCode)."
                    it.completed.countDown()
                }
            }
        }
    }
    private val projectPickerLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri == null) {
                notifyProjectSelectionCancelled()
                return@registerForActivityResult
            }
            grantUriPermission(
                packageName,
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            projectPrefs.edit().putString(lastProjectUriKey, uri.toString()).apply()
            currentProjectUri = uri
            loadProjectFiles(uri)
        }

    private val commandServiceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            commandService = IDebianCommandService.Stub.asInterface(service)
            synchronized(terminalLock) { terminalSession = null }
            Log.d("MainActivity", "LunusDroid service connected")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            commandService = null
            synchronized(terminalLock) {
                terminalSession = null
                pendingTerminalCommand?.let {
                    it.error = "Serviço LunusDroid desconectado."
                    it.completed.countDown()
                }
            }
            Log.w("MainActivity", "LunusDroid service disconnected")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.layout)
        bindLunusDroidService()

        myWebView = findViewById(R.id.webview)
        myWebView.settings.javaScriptEnabled = true
        myWebView.settings.domStorageEnabled = true
        myWebView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                pluginZipPickerLauncher.launch(arrayOf("application/zip", "application/octet-stream"))
                return true
            }
        }

        val webAppInterface = WebAppInterface(this, this)
        myWebView.addJavascriptInterface(webAppInterface, "Android")

        startEditor(myWebView)
        myWebView.loadUrl(EDITOR_URL)
        hideSystemUI()
    }

    override fun onDestroy() {
        // Ir para segundo plano ou recriar a Activity não encerra o shell.
        // A sessão continua pertencendo ao processo enquanto ele estiver vivo.
        if (isFinishing) {
            synchronized(terminalLock) {
                try { terminalSession?.close() } catch (_: Exception) { }
                terminalSession = null
                pendingTerminalCommand?.completed?.countDown()
                pendingTerminalCommand = null
            }
        }
        super.onDestroy()
        try {
            unbindService(commandServiceConnection)
        } catch (_: IllegalArgumentException) {
            // serviço ainda não estava vinculado
        }
    }

    private fun bindLunusDroidService() {
        val intent = Intent().apply {
            component = ComponentName(
                "com.g4b3r.lunusdroid",
                "com.g4b3r.lunusdroid.integration.DebianCommandService"
            )
        }

        try {
            bindService(intent, commandServiceConnection, Context.BIND_AUTO_CREATE)
        } catch (error: Exception) {
            Log.w("MainActivity", "Não foi possível conectar ao serviço LunusDroid", error)
        }
    }

    private fun restoreLastProject() {
        val savedUri = projectPrefs.getString(lastProjectUriKey, null)?.let(Uri::parse) ?: return
        val hasPermission = contentResolver.persistedUriPermissions.any {
            it.uri == savedUri && it.isReadPermission
        }
        if (!hasPermission) {
            projectPrefs.edit().remove(lastProjectUriKey).apply()
            return
        }
        currentProjectUri = savedUri
        loadProjectFiles(savedUri)
    }

    fun saveProjectFile(relativePath: String, content: String, mimeType: String = "application/octet-stream"): Boolean {
        val parts = ProjectPathValidator.components(relativePath) ?: return false
        return try {
            val root = currentProjectUri?.let { DocumentFile.fromTreeUri(this, it) } ?: return false
            var parent = root
            parts.dropLast(1).forEach { name ->
                parent = parent.findFile(name)?.takeIf { it.isDirectory }
                    ?: parent.createDirectory(name) ?: return false
            }
            val fileName = parts.last()
            val existing = parent.listFiles().firstOrNull { it.name == fileName && !it.isDirectory }
            val target = existing ?: parent.createFile(mimeType.ifBlank { "application/octet-stream" }, fileName) ?: return false
            contentResolver.openOutputStream(target.uri, "wt")?.bufferedWriter().use { writer ->
                writer ?: return false
                writer.write(content)
            }
            true
        } catch (error: Exception) {
            Log.w("MainActivity", "Não foi possível salvar arquivo do projeto", error)
            false
        }
    }


    fun executeLunusDroidCommand(command: String, workingDirectory: String = "/sdcard"): String {
        val service = commandService
        if (service == null) {
            return "{\"success\":false,\"exitCode\":-1,\"output\":\"\",\"error\":\"LunusDroid não disponível.\"}"
        }

        return try {
            executeInContinuousSession(service, command, workingDirectory)
        } catch (error: Exception) {
            Log.e("MainActivity", "Erro na execução do comando no LunusDroid", error)
            "{\"success\":false,\"exitCode\":-1,\"output\":\"\",\"error\":${JSONObject.quote(error.message ?: "Erro desconhecido")}}"
        }
    }

    fun isTerminalServiceConnected(): Boolean = commandService != null

    // Results belong to this Activity's trusted editor; destruction cancels delivery.
    fun executeLunusDroidCommandAsync(requestId: String, command: String, workingDirectory: String): Boolean {
        if (isFinishing || isDestroyed || !::myWebView.isInitialized) return false
        return myWebView.post {
            if (isFinishing || isDestroyed) return@post
            lifecycleScope.launch {
                val result = runInterruptible(Dispatchers.IO) {
                    if (command.isBlank()) {
                        "{\"success\":true,\"exitCode\":0,\"output\":\"\",\"error\":\"\"}"
                    } else {
                        executeLunusDroidCommand(command, workingDirectory)
                    }
                }
                if (isFinishing || isDestroyed || !isTrustedEditorUrl(myWebView.url)) return@launch
                val detail = JSONObject(result).put("requestId", requestId).toString()
                myWebView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('android:terminal-result', {detail: $detail}));",
                    null
                )
            }
        }
    }

    fun savePluginZip(base64: String, fileName: String) {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        runOnUiThread {
            pendingZipBytes = bytes
            pluginZipSaveLauncher.launch(fileName.ifBlank { "plugins.zip" })
        }
    }

    fun savePluginFile(fileName: String, content: String): Boolean {
        val safeName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val directory = File(filesDir, "plugins").apply { mkdirs() }
        return try {
            File(directory, safeName).writeText(content, Charsets.UTF_8)
            true
        } catch (_: Exception) { false }
    }

    private fun executeInContinuousSession(
        service: IDebianCommandService,
        command: String,
        workingDirectory: String,
    ): String {
        val marker = "__MCODE_DONE_${UUID.randomUUID()}__"
        val startMarker = marker.replace("_DONE_", "_START_")
        val pending = PendingTerminalCommand(marker, startMarker)
        val session = synchronized(terminalLock) {
            if (terminalSession == null) {
                terminalSession = service.createTerminalSession(terminalCallback, 24, 80)
            }
            terminalSession
        } ?: throw RemoteException("Não foi possível criar a sessão contínua.")

        synchronized(terminalLock) {
            if (pendingTerminalCommand != null) {
                throw IllegalStateException("Já existe um comando em execução no terminal.")
            }
            pendingTerminalCommand = pending
        }

        try {
            // Framing excludes the shell prompt, PTY echo and internal completion command.
            val commandText = buildTerminalCommand(command, workingDirectory, startMarker, marker)
            session.write((commandText + "\r").toByteArray(StandardCharsets.UTF_8))
            if (!pending.completed.await(10, TimeUnit.MINUTES)) {
                pending.error = "Tempo limite excedido (10 minutos)."
                // Não reutilize um shell que ainda pode estar executando o comando.
                synchronized(terminalLock) {
                    try { terminalSession?.close() } catch (_: Exception) { }
                    terminalSession = null
                }
            }
        } finally {
            synchronized(terminalLock) { pendingTerminalCommand = null }
        }

        val output = cleanTerminalOutput(pending.output.toString(), pending.startMarker)
        val exitCode = pending.exitCode ?: -1
        val error = pending.error ?: if (pending.exitCode == null) {
            "A sessão não retornou o exit code do comando."
        } else ""
        val success = error.isEmpty() && exitCode == 0
        return "{\"success\":${success},\"exitCode\":${exitCode},\"output\":${JSONObject.quote(output)},\"error\":${JSONObject.quote(error)}}"
    }


    fun requestOpenProject() {
        runOnUiThread { projectPickerLauncher.launch(null) }
    }

    private fun notifyProjectSelectionCancelled() {
        myWebView.post {
            myWebView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('android:project-cancelled', { detail: { ok: false } }));",
                null
            )
        }
    }

    private fun loadProjectFiles(rootUri: Uri) {
        projectLoadJob?.cancel()
        projectIndex = null
        myWebView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('android:project-loading'));", null
        )
        projectLoadJob = lifecycleScope.launch {
            try {
                val (index, payload) = withContext(Dispatchers.IO) {
                    val root = DocumentFile.fromTreeUri(this@MainActivity, rootUri)
                        ?: error("Não foi possível abrir o projeto.")
                    val files = linkedMapOf<String, Uri>()
                    collectProjectFiles(root, "", files)
                    val entries = JSONArray()
                    files.keys.forEach { name ->
                        entries.put(JSONObject().put("name", name).put("projectRoot", rootUri.toString()))
                    }
                    ProjectIndex(rootUri, files) to JSONObject().apply {
                        put("rootUri", rootUri.toString())
                        put("terminalDirectory", terminalDirectoryFor(rootUri))
                        put("files", entries)
                    }
                }
                projectIndex = index
                myWebView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('android:project-opened', { detail: $payload }));",
                    null
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                Log.e("MainActivity", "Erro ao abrir projeto", error)
                Toast.makeText(this@MainActivity, "Não foi possível abrir o projeto.", Toast.LENGTH_LONG).show()
                notifyProjectSelectionCancelled()
            }
        }
    }

    // Called on the WebView bridge's background thread, only for the requested file.
    fun readProjectFile(rootUri: String, relativePath: String): String {
        return try {
            val index = projectIndex ?: error("O projeto ainda não está disponível.")
            check(index.root.toString() == rootUri && index.root == currentProjectUri) {
                "Este arquivo pertence a outro projeto."
            }
            val uri = index.files[relativePath] ?: error("Arquivo não encontrado.")
            val limit = 2 * 1024 * 1024
            val bytes = contentResolver.openInputStream(uri)?.use { input ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                while (true) {
                    val count = input.read(chunk)
                    if (count < 0) break
                    check(buffer.size() + count <= limit) { "Arquivo maior que o limite de 2 MB do editor." }
                    buffer.write(chunk, 0, count)
                }
                buffer.toByteArray()
            } ?: error("Não foi possível ler o arquivo.")
            check(!bytes.contains(0.toByte())) { "Arquivos binários não podem ser abertos no editor." }
            val content = Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString()
            JSONObject().put("success", true).put("content", content).toString()
        } catch (error: Exception) {
            JSONObject().put("success", false)
                .put("error", error.message ?: "Não foi possível ler o arquivo como texto UTF-8.").toString()
        }
    }

    /** Converte a árvore primary do armazenamento Android para o mount Debian. */
    private fun terminalDirectoryFor(uri: Uri): String {
        return try {
            val documentId = DocumentsContract.getTreeDocumentId(uri)
            if (documentId.startsWith("raw:", ignoreCase = true)) {
                val rawPath = documentId.substringAfter(':')
                if (rawPath.startsWith("/storage/emulated/0")) {
                    val relative = rawPath.removePrefix("/storage/emulated/0").trim('/')
                    return if (relative.isBlank()) "/sdcard" else "/sdcard/$relative"
                }
            }
            if (!documentId.startsWith("primary:", ignoreCase = true)) return "/sdcard"
            val relative = documentId.substringAfter(':').trim('/')
            if (relative.isBlank()) "/sdcard" else "/sdcard/$relative"
        } catch (_: Exception) {
            "/sdcard"
        }
    }

    private suspend fun collectProjectFiles(
        documentFile: DocumentFile,
        relativePath: String,
        files: MutableMap<String, Uri>,
    ) {
        coroutineContext.ensureActive()
        val name = documentFile.name ?: return
        if (documentFile.isDirectory) {
            if (relativePath.isNotEmpty() && name in ignoredProjectDirectories) return
            for (child in documentFile.listFiles()) {
                val childName = child.name ?: continue
                val nextPath = if (relativePath.isBlank()) childName else "$relativePath/$childName"
                collectProjectFiles(child, nextPath, files)
            }
        } else {
            files[relativePath] = documentFile.uri
        }
    }

    private fun hideSystemUI() {
        // Configura a janela para que o conteúdo ocupe todo o espaço físico da tela
        WindowCompat.setDecorFitsSystemWindows(window, false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Solução moderna para Android 11 (API 30) ou superior
            window.insetsController?.let { controller ->
                // Esconde a barra de status (superior) e de navegação (inferior)
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                // Define o comportamento para que as barras apareçam temporariamente ao deslizar o dedo
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            // Solução legada para Android 10 (API 29) ou inferior (Depreciado)
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            or View.SYSTEM_UI_FLAG_FULLSCREEN
                    )
        }
    }


    private fun openExternalEditorLink(uri: Uri) {
        if (uri.scheme !in setOf("https", "http") || uri.host.isNullOrBlank()) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (error: ActivityNotFoundException) {
            Toast.makeText(this, "Nenhum aplicativo disponível para abrir o link.", Toast.LENGTH_SHORT).show()
        } catch (error: SecurityException) {
            Log.w("MainActivity", "Não foi possível abrir o link externo", error)
        }
    }

   private fun  startEditor(myWebView: WebView){
// Configuração do WebView

       myWebView.webViewClient = object : WebViewClient() {
           override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean {
               val url = request.url.toString()
               // Keep the sandboxed srcdoc preview and its blank reset working.
               if (isAllowedEditorNavigation(url, request.isForMainFrame)) return false
               if (request.isForMainFrame && request.hasGesture() && request.method == "GET") {
                   openExternalEditorLink(request.url)
               }
               return true
           }

           override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? {
               // POST navigations do not go through shouldOverrideUrlLoading.
               val destination = request.requestHeaders.entries
                   .firstOrNull { it.key.equals("Sec-Fetch-Dest", ignoreCase = true) }?.value
               val isDocument = request.isForMainFrame || destination in setOf("iframe", "frame", "document")
               if (isDocument && !isAllowedEditorNavigation(request.url.toString(), request.isForMainFrame)) {
                   return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), "".byteInputStream())
               }
               return super.shouldInterceptRequest(view, request)
           }

           override fun onPageFinished(view: WebView?, url: String?) {
               super.onPageFinished(view, url)
               if (!isTrustedEditorUrl(url) || !isTrustedEditorUrl(view?.url)) return

               // Inform the Web side that Android is ready
               myWebView.evaluateJavascript("window.dispatchEvent(new CustomEvent('android:ready'));", null)
               restoreLastProject()

               myWebView.evaluateJavascript(
                   """
            (() => {
              const addMenu = () => {
                if (!window.CodeEditorAPI) {
                  setTimeout(addMenu, 50);
                  return;
                }

                window.CodeEditorAPI.addTopbarOption({
                  id: 'arquivos',
                  type: 'menu',
                  label: 'arquivos',
                  icon: '⋮',
                  items: [
                    {
                      id: 'listaPlugins',
                      label: 'Lista de plugins',
                      icon: '☷',
                      onClick() { window.openPluginList?.(); }
                    },
                    {
                      id: 'criarArquivo',
                      label: 'Criar arquivo no diretório atual',
                      icon: '＋',
                      onClick() { window.createFileInCurrentDirectory?.(); }
                    },
                    {
                      id: 'adicionarPlugin',
                      label: 'Adicionar plugin',
                      icon: '🧩',
                      onClick() { window.choosePluginZip?.(); }
                    },
                    {
                      id: 'exportarPlugins',
                      label: 'Exportar plugins (.zip)',
                      icon: '📦',
                      onClick() { window.exportPluginsZip?.(); }
                    },
                    {
                      id: 'terminal',
                      label: 'Abrir terminal',
                      icon: '⌁',
                      onClick() {
                        window.openTerminal?.();
                      }
                    },
                    {
                      id: 'abrirProjeto',
                      label: 'abrir projeto',
                      icon: '✨',
                      onClick() {
                        if (window.Android && typeof window.Android.openProjectPicker === 'function') {
                          window.Android.openProjectPicker();
                        } else {
                          console.warn('Android.openProjectPicker não disponível');
                        }
                      }
                    },
                    {
                      id: 'configurar',
                      label: 'Configurações',
                      onClick() { window.openSettings?.(); }
                    }
                  ]
                });
              };

              addMenu();
            })();
            """.trimIndent(),
                   null
               )
           }
       }

    }
}
