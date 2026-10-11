package com.g4b3r.m_code

import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONObject
import java.util.UUID

class WebAppInterface(
    private val mContext: Context,
    private val activity: MainActivity? = null
) {

    @JavascriptInterface
    fun isTerminalAvailable(): Boolean {
        return activity?.isTerminalServiceConnected() == true
    }

    @JavascriptInterface
    fun showToast(toast: String) {
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            Toast.makeText(mContext, toast, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun onFileSaved(fileName: String) {
        println("File saved from editor: $fileName")
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return "1.0.0-android"
    }

    @JavascriptInterface
    fun openProjectPicker() {
        activity?.requestOpenProject()
    }

    @JavascriptInterface
    fun runCode(payload: String): String {
        // A gravação do arquivo e sua execução percorrem a mesma sessão contínua
        // usada pelo terminal; não use IDebianCommandService.execute aqui.
        if (activity == null) {
            return "{\"success\":false,\"exitCode\":-1,\"output\":\"\",\"error\":\"App não inicializado.\"}"
        }

        return try {
            val root = JSONObject(payload)
            val workingDirectory = root.optString("workingDirectory", "/sdcard").trim().ifEmpty { "/sdcard" }
            val command = root.optString("command", "")
            // O arquivo já pertence ao projeto; apenas entra na pasta e executa.
            // Alterações não salvas devem ser persistidas pelo menu Salvar antes de executar.
            val scriptRun = activity.executeLunusDroidCommand("$command", workingDirectory)
            Log.d("Web","$command"+workingDirectory )
            if (scriptRun.isNotBlank()) scriptRun else "{\"success\":false,\"exitCode\":-1,\"output\":\"\",\"error\":\"Sem resposta do serviço.\"}"
        } catch (error: Exception) {
            "{\"success\":false,\"exitCode\":-1,\"output\":\"\",\"error\":${JSONObject.quote(error.message ?: "Erro ao executar no LunusDroid")}}"
        }
    }

    /** Executa um comando na sessão contínua sem criar um arquivo temporário. */
    @JavascriptInterface
    fun runTerminalCommand(command: String, workingDirectory: String = "/sdcard"): String {
        val host = activity ?: return "{\"success\":false,\"exitCode\":-1,\"output\":\"\",\"error\":\"App não inicializado.\"}"
        if (command.isBlank()) return "{\"success\":true,\"exitCode\":0,\"output\":\"\",\"error\":\"\"}"
        return host.executeLunusDroidCommand(command, workingDirectory.ifBlank { "/sdcard" })
    }

    /** Returns a JSON acknowledgement immediately; listen for android:terminal-result before calling.
     * The event detail contains requestId, success, exitCode, output and error.
     * accepted=false means no command was scheduled and no result event will follow.
     */
    @JavascriptInterface
    fun runTerminalCommandAsync(command: String, workingDirectory: String = "/sdcard"): String {
        val requestId = UUID.randomUUID().toString()
        val accepted = activity?.executeLunusDroidCommandAsync(
            requestId, command, workingDirectory.ifBlank { "/sdcard" }
        ) == true
        return JSONObject().put("requestId", requestId).put("accepted", accepted)
            .put("error", if (accepted) "" else "Editor não disponível para executar o comando.")
            .toString()
    }

    @JavascriptInterface
    fun readProjectFile(rootUri: String, fileName: String): String {
        return activity?.readProjectFile(rootUri, fileName)
            ?: "{\"success\":false,\"error\":\"App não inicializado.\"}"
    }

    @JavascriptInterface
    fun saveProjectFile(fileName: String, content: String, mimeType: String = "application/octet-stream"): Boolean {
        return activity?.saveProjectFile(fileName, content, mimeType) == true
    }

    @JavascriptInterface
    fun savePluginZip(base64: String, fileName: String = "plugins.zip") {
        activity?.savePluginZip(base64, fileName)
    }

    @JavascriptInterface
    fun savePluginFile(fileName: String, content: String): Boolean {
        return activity?.savePluginFile(fileName, content) == true
    }
}
