package com.g4b3r.m_code

import android.content.ComponentName
import android.content.ServiceConnection
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.os.Looper
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.lifecycle.Lifecycle
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
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class AsyncTerminalBridgeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private class FakeService : IDebianCommandService.Stub() {
        val writes = LinkedBlockingQueue<String>()
        val sessions = AtomicInteger()
        val closes = AtomicInteger()
        val sizes = LinkedBlockingQueue<Pair<Int, Int>>()
        @Volatile var callback: IDebianTerminalCallback? = null
        @Volatile var wroteOnMain = false
        val session = object : IDebianTerminalSession.Stub() {
            override fun write(data: ByteArray) {
                wroteOnMain = Looper.myLooper() == Looper.getMainLooper()
                writes.offer(String(data, Charsets.UTF_8))
            }
            override fun resize(rows: Int, cols: Int) { sizes.offer(rows to cols) }
            override fun close() { closes.incrementAndGet(); callback?.onSessionClosed(0) }
        }
        override fun execute(command: String, workingDirectory: String): Bundle =
            error("The asynchronous bridge must use the continuous session")
        override fun createTerminalSession(callback: IDebianTerminalCallback, rows: Int, cols: Int): IDebianTerminalSession {
            this.callback = callback
            sessions.incrementAndGet()
            return session
        }
        fun complete(command: String) {
            val start = Regex("__MCODE_START_[a-f0-9-]+__").find(command)!!.value
            val end = Regex("__MCODE_DONE_[a-f0-9-]+__").find(command)!!.value
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

    @Test(timeout = 15000) fun interactiveSessionStreamsBeforeExitAndAcceptsInputResizeAndClose() {
        for (character in listOf("á", "€", "😀")) {
            val bytes = character.toByteArray()
            for (split in 1 until bytes.size) {
                val decoder = IncrementalUtf8Decoder()
                assertEquals("", decoder.decode(bytes.copyOfRange(0, split)))
                assertEquals(character, decoder.decode(bytes.copyOfRange(split, bytes.size)) + decoder.finish())
                assertEquals("", decoder.decode(bytes.copyOfRange(0, split)))
                assertEquals("\uFFFD", decoder.finish())
            }
        }
        val fake = FakeService()
        val terminal = InteractiveTerminalSession()
        try {
            assertTrue(terminal.open(fake, "interactive", "/sdcard/a'b", 24, 80))
            assertEquals("cd -- '/sdcard/a'\"'\"'b'\n", fake.writes.poll(5, TimeUnit.SECONDS))
            assertTrue(terminal.write("interactive", "python3 -m http.server\n"))
            assertEquals("python3 -m http.server\n", fake.writes.poll(5, TimeUnit.SECONDS))
            val callback = fake.callback!!
            callback.onOutput("\u001B[32mServing HTTP\u001B[0m\r\n".toByteArray())
            val bytes = "😀".toByteArray()
            callback.onOutput(bytes.copyOfRange(0, 2))
            val first = JSONObject(terminal.read("interactive"))
            assertEquals("open", first.getString("state"))
            assertTrue(first.getString("output").contains("\u001B[32mServing HTTP"))
            callback.onOutput(bytes.copyOfRange(2, bytes.size))
            assertEquals("😀", JSONObject(terminal.read("interactive")).getString("output"))
            assertTrue(terminal.write("interactive", "answer\r"))
            assertEquals("answer\r", fake.writes.poll(5, TimeUnit.SECONDS))
            assertTrue(terminal.write("interactive", "\u0003"))
            assertEquals("\u0003", fake.writes.poll(5, TimeUnit.SECONDS))
            assertTrue(terminal.resize("interactive", 30, 100))
            assertEquals(30 to 100, fake.sizes.poll(5, TimeUnit.SECONDS))
            callback.onOutput("x".repeat(300000).toByteArray())
            val large = JSONObject(terminal.read("interactive"))
            assertTrue(large.getBoolean("truncated"))
            assertTrue(large.getString("output").length <= 16384)
            assertTrue(terminal.close("interactive"))
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (JSONObject(terminal.read("interactive")).getString("state") != "closed") {
                check(System.nanoTime() < deadline)
                Thread.sleep(10)
            }
            assertTrue(terminal.open(fake, "replacement", "/sdcard", 24, 80))
            assertNotNull(fake.writes.poll(5, TimeUnit.SECONDS))
            callback.onOutput("old output".toByteArray())
            callback.onSessionClosed(99)
            assertEquals("open", JSONObject(terminal.read("replacement")).getString("state"))
            assertFalse(terminal.write("interactive", "stale"))
            fake.callback!!.onOutput(bytes.copyOfRange(0, 2))
            fake.callback!!.onSessionClosed(7)
            val closed = JSONObject(terminal.read("replacement"))
            assertEquals("\uFFFD", closed.getString("output"))
            assertEquals(7, closed.getInt("exitCode"))
        } finally { terminal.dispose() }
        assertFalse(terminal.open(fake, "destroyed", "/sdcard", 24, 80))
    }

    @Test(timeout = 30000) fun interactiveWebViewDisplaysLiveLogsAndSendsInput() {
        val fake = FakeService()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var webView: WebView
            scenario.onActivity { activity ->
                webView = activity.findViewById(R.id.webview)
                val connection = MainActivity::class.java.getDeclaredField("commandServiceConnection")
                    .apply { isAccessible = true }.get(activity) as ServiceConnection
                try { activity.unbindService(connection) } catch (_: IllegalArgumentException) { }
                connection.onServiceConnected(ComponentName("test", "FakeService"), fake)
            }
            fun waitFor(expression: String) {
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8)
                while (evaluate(webView, expression) != "true") {
                    check(System.nanoTime() < deadline) { "WebView did not satisfy: $expression" }
                    Thread.sleep(20)
                }
            }
            waitFor("Boolean(window.CodeEditorAPI)")
            evaluate(webView, "window.openTerminal()")
            assertNotNull(fake.writes.poll(5, TimeUnit.SECONDS))
            fake.callback!!.onOutput("\u001B[32mServing HTTP\u001B[0m\r\n".toByteArray())
            waitFor("document.querySelector('.xterm-rows')?.textContent.includes('Serving HTTP') === true")
            evaluate(webView, """
                document.getElementById('terminalInput').value = 'python3 -m http.server';
                document.getElementById('terminalForm').dispatchEvent(new Event('submit', {cancelable: true}));
            """.trimIndent())
            assertEquals("python3 -m http.server\r", fake.writes.poll(5, TimeUnit.SECONDS))
            fake.callback!!.onOutput("GET / 200\r\n".toByteArray())
            waitFor("document.querySelector('.xterm-rows')?.textContent.includes('GET / 200') === true")
            evaluate(webView, "[...document.querySelectorAll('#terminalPanel button')].find(b => b.textContent === 'Ctrl+C').click()")
            assertEquals("\u0003", fake.writes.poll(5, TimeUnit.SECONDS))
            evaluate(webView, "[...document.querySelectorAll('#terminalPanel button')].find(b => b.textContent === 'Encerrar sessão').click()")
            waitFor("document.querySelector('.xterm-rows')?.textContent.includes('Sessão encerrada') === true")
            assertEquals(1, fake.sessions.get())
            assertEquals(1, fake.closes.get())
        }
    }

    @Test(timeout = 60000) fun backgroundRotationRecreationAndStaleCallbacks() {
        val fake = FakeService()
        val worker = Executors.newSingleThreadExecutor()
        val serviceField = MainActivity::class.java.getDeclaredField("commandService").apply { isAccessible = true }
        val connectionField = MainActivity::class.java.getDeclaredField("commandServiceConnection").apply { isAccessible = true }
        val pendingField = MainActivity::class.java.getDeclaredField("pendingTerminalCommand").apply { isAccessible = true }
        lateinit var current: MainActivity
        fun attach(scenario: ActivityScenario<MainActivity>) {
            scenario.onActivity { activity ->
                current = activity
                val connection = connectionField.get(activity) as ServiceConnection
                try { activity.unbindService(connection) } catch (_: IllegalArgumentException) { }
                connection.onServiceConnected(ComponentName("test", "FakeService"), fake)
            }
        }
        fun submit() = worker.submit<String> { current.executeLunusDroidCommand("echo lifecycle") }
        fun written() = fake.writes.poll(5, TimeUnit.SECONDS) ?: error("Command was not written")
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                attach(scenario)
                val first = submit()
                fake.complete(written())
                assertTrue(JSONObject(first.get(5, TimeUnit.SECONDS)).getBoolean("success"))

                scenario.moveToState(Lifecycle.State.CREATED)
                val background = submit()
                fake.complete(written())
                assertTrue(JSONObject(background.get(5, TimeUnit.SECONDS)).getBoolean("success"))
                scenario.moveToState(Lifecycle.State.RESUMED)
                assertEquals(1, fake.sessions.get())
                assertEquals(0, fake.closes.get())

                val waiting = submit()
                written()
                val oldActivity = current
                val oldConnection = connectionField.get(oldActivity) as ServiceConnection
                val oldCallback = fake.callback!!
                val pending = pendingField.get(oldActivity) as MainActivity.PendingTerminalCommand
                scenario.onActivity {
                    it.requestedOrientation = if (it.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
                        ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    } else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                }
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
                do {
                    scenario.onActivity { current = it }
                    if (current !== oldActivity) break
                    check(System.nanoTime() < deadline) { "Rotation did not recreate the Activity" }
                    Thread.sleep(20)
                } while (true)
                val failure = JSONObject(waiting.get(5, TimeUnit.SECONDS))
                assertFalse(failure.getBoolean("success"))
                assertTrue(failure.getString("error").contains("Activity"))
                assertEquals(1, fake.closes.get())
                val outputAtDestruction = pending.output.toString()
                oldCallback.onOutput("stale output".toByteArray())
                oldCallback.onSessionClosed(42)
                instrumentation.runOnMainSync {
                    oldConnection.onServiceConnected(ComponentName("test", "LateService"), fake)
                    oldConnection.onServiceDisconnected(ComponentName("test", "LateService"))
                    assertFalse(oldActivity.executeLunusDroidCommandAsync("late", "echo late", "/sdcard"))
                }
                assertNull(serviceField.get(oldActivity))
                assertEquals(outputAtDestruction, pending.output.toString())
                assertFalse(JSONObject(oldActivity.executeLunusDroidCommand("echo late")).getBoolean("success"))

                attach(scenario)
                val afterRotation = submit()
                fake.complete(written())
                assertTrue(JSONObject(afterRotation.get(5, TimeUnit.SECONDS)).getBoolean("success"))
                assertEquals(2, fake.sessions.get())

                // A late close/output from an old session cannot complete or close its replacement.
                val previousCallback = fake.callback!!
                previousCallback.onSessionClosed(0)
                val replacement = submit()
                val replacementWrite = written()
                val replacementMarker = Regex("__MCODE_DONE_[a-f0-9-]+__").find(replacementWrite)!!.value
                previousCallback.onOutput("\n$replacementMarker:99\n".toByteArray())
                previousCallback.onSessionClosed(99)
                assertFalse(replacement.isDone)
                fake.complete(replacementWrite)
                assertEquals(0, JSONObject(replacement.get(5, TimeUnit.SECONDS)).getInt("exitCode"))
                assertEquals(3, fake.sessions.get())

                val beforeRecreation = current
                scenario.recreate()
                assertEquals(2, fake.closes.get())
                assertNull(serviceField.get(beforeRecreation))
                attach(scenario)
                val recreated = submit()
                fake.complete(written())
                assertTrue(JSONObject(recreated.get(5, TimeUnit.SECONDS)).getBoolean("success"))
                assertEquals(4, fake.sessions.get())
            }
            assertEquals(3, fake.closes.get())
            assertNull(serviceField.get(current))
        } finally {
            worker.shutdownNow()
        }
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
