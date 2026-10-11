package com.g4b3r.m_code

import org.junit.Assert.*
import org.junit.Test

class TerminalOutputTest {
    private val start = "__MCODE_START_test__"
    private val done = "__MCODE_DONE_test__"

    @Test fun removesPtyEchoAndEscapesButPreservesCpuinfoErrors() {
        val command = buildTerminalCommand("python3 exemplo.py", "/sdcard/Ptorch", start, done)
        val raw = "\u001b[?2004hroot@localhost:/sdcard# $command" +
            "\u001b[?2004l\r\n$start\r\n" +
            "Error in cpuinfo: failed to parse the list of possible processors\r\n" +
            "\u001b[32mtensor([11., 22., 33.])\u001b[0m\r\n" +
            "torch.Size([3])\r\n\r\n$done:0\r\nroot@localhost# "
        val completion = findTerminalCompletion(raw, done)!!
        assertEquals(0, completion.exitCode)
        assertEquals(
            "Error in cpuinfo: failed to parse the list of possible processors\n" +
                "tensor([11., 22., 33.])\ntorch.Size([3])",
            cleanTerminalOutput(raw.substring(0, completion.markerStart), start)
        )
    }

    @Test fun preservesWhitespaceRepeatedLinesAndPromptLikeProgramOutput() {
        assertEquals("  hello  \nroot@localhost# example\nx\nx", cleanTerminalOutput(
            "$start\n  hello  \nroot@localhost# example\nx\nx\n\n", start))
        assertEquals("", cleanTerminalOutput("$start\n\n", start))
    }

    @Test fun rendersProgressBackspacesAndRemovesWindowTitles() {
        assertEquals("100%\nabc", cleanTerminalOutput(
            "$start\n\u001b]0;title\u0007" +
                "  0%\r100%\r\nabx\bc\u001b]0;title\u001b\\", start))
    }

    @Test fun shellFramingPreservesQuotesStateAndExitStatus() {
        val shell = ProcessBuilder("sh").start()
        shell.outputStream.bufferedWriter().use {
            it.write(buildTerminalCommand("export MCODE_TEST='a b'; printf '%s' \"\$MCODE_TEST\"", "/tmp", start, done))
            it.write(buildTerminalCommand("printf '%s' \"\$MCODE_TEST\"; false", "/tmp", "start2", "done2"))
        }
        val output = shell.inputStream.bufferedReader().readText()
        assertTrue(shell.waitFor(5, java.util.concurrent.TimeUnit.SECONDS))
        assertTrue(output.contains("$start\na b\n$done:0\n"))
        assertTrue(output.contains("start2\na b\ndone2:1\n"))
    }

    @Test fun invalidDirectoryDoesNotExecuteUserCommand() {
        val shell = ProcessBuilder("sh").start()
        shell.outputStream.bufferedWriter().use {
            it.write(buildTerminalCommand("printf SHOULD_NOT_RUN; true", "/mcode-missing-'directory", start, done))
        }
        val output = shell.inputStream.bufferedReader().readText()
        assertTrue(shell.waitFor(5, java.util.concurrent.TimeUnit.SECONDS))
        assertFalse(output.contains("SHOULD_NOT_RUN"))
        assertEquals(1, findTerminalCompletion(output, done)?.exitCode)
    }
}
