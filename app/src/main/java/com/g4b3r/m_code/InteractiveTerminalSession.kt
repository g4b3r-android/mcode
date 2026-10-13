package com.g4b3r.m_code

import com.g4b3r.lunusdroid.integration.IDebianCommandService
import com.g4b3r.lunusdroid.integration.IDebianTerminalCallback
import com.g4b3r.lunusdroid.integration.IDebianTerminalSession
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Activity-owned PTY. No Activity/WebView reference is retained by Binder callbacks. */
internal class InteractiveTerminalSession {
    private val lock = Any()
    private val executor = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(64))
    private val decoder = IncrementalUtf8Decoder()
    private val output = StringBuilder()
    private var session: IDebianTerminalSession? = null
    private var id = ""
    private var generation = 0L
    private var state = "closed"
    private var error = ""
    private var exitCode: Int? = null
    private var truncated = false
    private var disposed = false

    private fun enqueue(action: () -> Unit): Boolean = try {
        executor.execute(action)
        true
    } catch (_: java.util.concurrent.RejectedExecutionException) { false }

    // All buffer operations are serialized with lifecycle/stream callbacks.
    private fun append(text: String) {
        output.append(text)
        if (output.length > 256 * 1024) {
            var start = output.length - 256 * 1024
            if (Character.isHighSurrogate(output[start - 1]) && Character.isLowSurrogate(output[start])) start++
            output.delete(0, start)
            truncated = true
        }
    }

    fun open(service: IDebianCommandService, requestId: String, directory: String, rows: Int, cols: Int): Boolean {
        val epoch = synchronized(lock) {
            if (disposed || requestId.isBlank() || requestId.length > 128 || state == "open" || state == "opening") return false
            id = requestId
            state = "opening"
            error = ""
            exitCode = null
            output.setLength(0)
            truncated = false
            decoder.reset()
            ++generation
        }
        val accepted = enqueue {
            var created: IDebianTerminalSession? = null
            try {
                val callback = object : IDebianTerminalCallback.Stub() {
                    override fun onOutput(data: ByteArray?) {
                        if (data == null) return
                        synchronized(lock) {
                            if (disposed || generation != epoch) return
                            append(decoder.decode(data))
                        }
                    }
                    override fun onSessionClosed(code: Int) {
                        synchronized(lock) {
                            if (disposed || generation != epoch) return
                            append(decoder.finish())
                            exitCode = code
                            state = "closed"
                            session = null
                            generation++
                        }
                    }
                }
                created = service.createTerminalSession(callback, rows.coerceIn(2, 200), cols.coerceIn(2, 300))
                    ?: error("Não foi possível criar o terminal.")
                val attached = synchronized(lock) {
                    if (disposed || generation != epoch) false else {
                        session = created
                        state = "open"
                        true
                    }
                }
                if (!attached) { closeQuietly(created); return@enqueue }
                val quotedDirectory = "'" + directory.replace("'", "'\"'\"'") + "'"
                created.write("cd -- $quotedDirectory\n".toByteArray(Charsets.UTF_8))
            } catch (failure: Exception) {
                fail(epoch, failure.message ?: "Falha ao abrir terminal.")
                closeQuietly(created)
            }
        }
        if (!accepted) fail(epoch, "Fila do terminal indisponível.")
        return accepted
    }

    private fun operate(requestId: String, action: (IDebianTerminalSession) -> Unit): Boolean {
        val epoch = synchronized(lock) {
            if (disposed || id != requestId || state !in listOf("opening", "open")) return false
            generation
        }
        return enqueue {
            val active = synchronized(lock) { if (generation == epoch && !disposed) session else null } ?: return@enqueue
            try { action(active) } catch (failure: Exception) {
                fail(epoch, failure.message ?: "Falha na sessão do terminal.")
                closeQuietly(active)
            }
        }
    }

    fun write(requestId: String, data: String): Boolean =
        data.length <= 16 * 1024 && operate(requestId) { it.write(data.toByteArray(Charsets.UTF_8)) }

    fun resize(requestId: String, rows: Int, cols: Int): Boolean =
        operate(requestId) { it.resize(rows.coerceIn(2, 200), cols.coerceIn(2, 300)) }

    fun close(requestId: String): Boolean = operate(requestId) {
        disconnect("", requestId)
        closeQuietly(it)
    }

    private fun fail(epoch: Long, message: String) {
        synchronized(lock) {
            if (generation != epoch) return
            append(decoder.finish())
            error = message
            state = "closed"
            session = null
            generation++
        }
    }

    fun disconnect(message: String, requestId: String? = null) {
        synchronized(lock) {
            if (requestId != null && requestId != id) return
            fail(generation, message)
        }
    }

    /** Nonblocking, bounded drain; the UI requests another batch only after rendering this one. */
    fun read(requestId: String): String = synchronized(lock) {
        if (id != requestId || disposed) return JSONObject().put("state", "closed")
            .put("error", "Sessão indisponível.").put("output", "").put("more", false).toString()
        var end = minOf(output.length, 16 * 1024)
        if (end < output.length && end > 0 && Character.isHighSurrogate(output[end - 1])) end--
        val text = output.substring(0, end)
        output.delete(0, end)
        JSONObject().put("state", state).put("output", text).put("error", error)
            .put("exitCode", exitCode ?: JSONObject.NULL).put("truncated", truncated)
            .put("more", output.isNotEmpty()).toString().also { truncated = false }
    }

    fun dispose() {
        val active = synchronized(lock) {
            disposed = true
            val active = session
            fail(generation, "Activity destruída.")
            output.setLength(0)
            active
        }
        executor.shutdownNow()
        closeQuietly(active)
    }

    private fun closeQuietly(active: IDebianTerminalSession?) {
        try { active?.close() } catch (_: Exception) { }
    }
}
