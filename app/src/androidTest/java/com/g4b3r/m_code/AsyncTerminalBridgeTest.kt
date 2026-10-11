package com.g4b3r.m_code

import android.content.ComponentName
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Looper
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.g4b3r.lunusdroid.integration.IDebianCommandService
import com.g4b3r.lunusdroid.integration.IDebianTerminalCallback
import com.g4b3r.lunusdroid.integration.IDebianTerminalSession
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class AsyncTerminalBridgeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private class FakeService : IDebianCommandService.Stub() {
        val writes = LinkedBlockingQueue<String>()
        val sessions = AtomicInteger()
        @Volatile var callback: IDebianTerminalCallback? = null
        @Volatile var wroteOnMain = false
        val session = object : IDebianTerminalSession.Stub() {
            override fun write(data: ByteArray) {
                wroteOnMain = Looper.myLooper() == Looper.getMainLooper()
                writes.offer(String(data, Charsets.UTF_8))
            }
            override fun resize(rows: Int, cols: Int) = Unit
            override fun close() { callback?.onSessionClosed(0) }
        }
        override fun execute(command: String, workingDirectory: String): Bundle =
            error("The asynchronous bridge must use the continuous session")
        override fun createTerminalSession(callback: IDebianTerminalCallback, rows: Int, cols: Int): IDebianTerminalSession {
            this.callback = callback
            sessions.incrementAndGet()
            return session
        }
        fun complete(command: String) {
            val start = Regex("__MCODE_START_[a-f0-9-]+").find(command)!!.value
            val end = Regex("__MCODE_DONE_[a-f0-9-]+").find(command)!!.value
            callback!!.onOutput("$start\r\nquoted \"output\"\r\n$end:0\r\n".toByteArray())
        }
    }

    private fun evaluate(webView: WebView, expression: String): String {
        val ready = CountDownLatch(1)
        var result = ""
        instrumentation.runOnMainSync {
            webView.evaluateJavascript(expression) { result = it; ready.countDown() }
        }
        assertTrue("JavaScript callback timed out", ready.await(5, TimeUnit.SECONDS))
        return result
    }

    private fun resultFor(webView: WebView, requestId: String): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (System.nanoTime() < deadline) {
            val raw = evaluate(webView, "window.__terminalResults[${JSONObject.quote(requestId)}] || null")
            if (raw != "null") return JSONObject(raw)
            Thread.sleep(20)
        }
        error("No terminal result for $requestId")
    }

    @Test fun missingActivityReturnsDistinctRejectedAcknowledgements() {
        val bridge = WebAppInterface(instrumentation.targetContext)
        val first = JSONObject(bridge.runTerminalCommandAsync("echo test"))
        val second = JSONObject(bridge.runTerminalCommandAsync("echo test"))
        assertFalse(first.getBoolean("accepted"))
        assertTrue(first.getString("error").isNotBlank())
        assertNotEquals(first.getString("requestId"), second.getString("requestId"))
    }

    @Test(timeout = 30000) fun correlatesResultsWithoutBlockingAndPreservesTheSession() {
        val fake = FakeService()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var webView: WebView
            lateinit var connection: ServiceConnection
            scenario.onActivity { activity ->
                webView = activity.findViewById(R.id.webview)
                val connectionField = MainActivity::class.java.getDeclaredField("commandServiceConnection").apply { isAccessible = true }
                connection = connectionField.get(activity) as ServiceConnection
                // Keep tests off the real LunusDroid service and its shell.
                try { activity.unbindService(connection) } catch (_: IllegalArgumentException) { }
                MainActivity::class.java.getDeclaredField("commandService").apply {
                    isAccessible = true
                    set(activity, fake)
                }
            }
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (evaluate(webView, "Boolean(window.CodeEditorAPI)") != "true") {
                check(System.nanoTime() < deadline) { "Editor did not load" }
                Thread.sleep(20)
            }
            evaluate(webView, """
                window.__terminalResults = {};
                window.addEventListener('android:terminal-result', event => {
                    window.__terminalResults[event.detail.requestId] = event.detail;
                });
            """.trimIndent())
            fun submit(command: String): String {
                val raw = evaluate(webView, "Android.runTerminalCommandAsync(${JSONObject.quote(command)}, '/sdcard')")
                val acknowledgement = JSONObject(JSONTokener(raw).nextValue() as String)
                assertTrue(acknowledgement.getBoolean("accepted"))
                return acknowledgement.getString("requestId")
            }
            val first = submit("echo first")
            val written = fake.writes.poll(5, TimeUnit.SECONDS)!!
            assertFalse(fake.wroteOnMain)
            // The first command is still waiting; the JS caller and main thread remain available.
            assertEquals("42", evaluate(webView, "6 * 7"))
            val busy = submit("echo concurrent")
            assertNotEquals(first, busy)
            assertFalse(resultFor(webView, busy).getBoolean("success"))
            assertTrue(resultFor(webView, busy).getString("error").contains("Já existe"))
            fake.complete(written)
            val completed = resultFor(webView, first)
            assertTrue(completed.getBoolean("success"))
            assertEquals(0, completed.getInt("exitCode"))
            assertTrue(completed.getString("output").contains("quoted \"output\""))

            val disconnected = submit("echo second")
            assertNotNull(fake.writes.poll(5, TimeUnit.SECONDS))
            assertEquals(1, fake.sessions.get())
            instrumentation.runOnMainSync {
                connection.onServiceDisconnected(ComponentName("test", "FakeService"))
            }
            val failure = resultFor(webView, disconnected)
            assertFalse(failure.getBoolean("success"))
            assertEquals(-1, failure.getInt("exitCode"))
            assertTrue(failure.getString("error").contains("desconectado"))
            val unavailable = resultFor(webView, submit("echo unavailable"))
            assertFalse(unavailable.getBoolean("success"))
            assertTrue(unavailable.getString("error").contains("não disponível"))
            assertTrue(resultFor(webView, submit(" ")).getBoolean("success"))
            assertEquals(1, fake.sessions.get())
        }
    }
}
