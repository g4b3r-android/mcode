package com.g4b3r.m_code

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalOutputRetentionTest {
    private val marker = "__MCODE_DONE_test__"
    private val startMarker = "__MCODE_START_test__"
    private val limit = MainActivity.TERMINAL_OUTPUT_LIMIT

    private fun pending() = MainActivity.PendingTerminalCommand(marker, startMarker)

    @Test
    fun normalOutputAndStatusAreUnchanged() {
        val command = pending()
        command.appendOutput("echoed command\r\n$startMarker\r\nOlá 😀\r\n$marker:0\r\nprompt")
        assertEquals("Olá 😀", command.formattedOutput())
        assertEquals(0, command.exitCode)
        assertEquals(0L, command.completed.count)
        assertFalse(command.truncated)
    }

    @Test
    fun largeChunkRetainsTailAndDoesNotDiscardCompletionBeforeItsEnd() {
        val command = pending()
        command.appendOutput("x".repeat(limit * 4) + "\núltimo erro\n$marker:127\n" + "prompt".repeat(limit))
        assertTrue(command.output.length <= limit)
        assertTrue(command.truncated)
        assertTrue(command.formattedOutput().startsWith("[terminal] Saída truncada;"))
        assertTrue(command.formattedOutput().endsWith("último erro"))
        assertEquals(127, command.exitCode)
        assertEquals(0L, command.completed.count)
        assertFalse(command.output.contains(marker))
        command.appendOutput("ignored after completion")
        assertTrue(command.formattedOutput().endsWith("último erro"))
    }

    @Test
    fun markerSurvivesEverySplitAfterTruncation() {
        val status = "$marker:${Int.MIN_VALUE}\r\n"
        for (split in 0 until status.length) {
            val command = pending()
            command.appendOutput("x".repeat(limit + 100) + "\n")
            command.appendOutput(status.substring(0, split))
            assertNull("Split $split", command.exitCode)
            assertEquals(1L, command.completed.count)
            command.appendOutput(status.substring(split))
            assertEquals("Split $split", Int.MIN_VALUE, command.exitCode)
            assertEquals(0L, command.completed.count)
            assertTrue(command.output.length <= limit)
            assertFalse(command.output.contains(marker))
        }
    }

    @Test
    fun repeatedChunksWithoutNewlinesRemainBoundedAndDoNotInventLineStarts() {
        val command = pending()
        repeat(100) {
            command.appendOutput("x".repeat(8192))
            assertTrue(command.output.length <= limit)
            assertNull(command.exitCode)
        }
        // Force a non-line-start marker to become the first retained characters.
        command.appendOutput("$marker:0\n" + "x".repeat(limit - marker.length - 3))
        command.appendOutput("more output")
        assertNull(command.exitCode)
        assertEquals(1L, command.completed.count)
        command.appendOutput("\n$marker:1\n")
        assertEquals(1, command.exitCode)
    }

    @Test
    fun truncationDoesNotLeaveHalfOfAnEmoji() {
        val command = pending()
        command.appendOutput("😀" + "x".repeat(limit - 1))
        assertEquals(limit - 1, command.output.length)
        assertEquals('x', command.output[0])
        assertTrue(command.truncated)
    }

    @Test
    fun incompleteMarkerDoesNotSignalCompletionAndClosureReplacementIsRetained() {
        val command = pending()
        command.appendOutput("x".repeat(limit * 2) + "\n$marker:0\r")
        command.appendOutput("\uFFFD")
        assertTrue(command.output.length <= limit)
        assertNull(command.exitCode)
        assertEquals(1L, command.completed.count)
        assertTrue(command.formattedOutput().startsWith("[terminal] Saída truncada;"))
    }
}
