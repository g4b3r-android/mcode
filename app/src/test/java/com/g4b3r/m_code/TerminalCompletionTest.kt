package com.g4b3r.m_code

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TerminalCompletionTest {
    private val marker = "__MCODE_DONE_test__"

    @Test fun successfulAndFailedCommands() {
        assertEquals(0, findTerminalCompletion("hello\n$marker:0\n", marker)?.exitCode)
        assertEquals(127, findTerminalCompletion("$marker:127\r\n", marker)?.exitCode)
    }

    @Test fun ignoresEchoAndIncompleteChunks() {
        val echo = "echo \"$marker:$?\"\r\n"
        assertNull(findTerminalCompletion(echo, marker))
        assertNull(findTerminalCompletion("$marker:", marker))
        assertNull(findTerminalCompletion("$marker:0\r", marker))
        assertNull(findTerminalCompletion("$marker:invalid\n", marker))
        val output = echo + "hello\r\n$marker:0\r\n"
        val result = findTerminalCompletion(output, marker)!!
        assertEquals(0, result.exitCode)
        assertEquals(echo + "hello\r\n", output.substring(0, result.markerStart))
    }
}
