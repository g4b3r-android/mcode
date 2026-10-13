package com.g4b3r.m_code

import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IncrementalUtf8DecoderTest {
    @Test
    fun preservesUnicodeAtEveryChunkBoundary() {
        val text = "ação € 日本語 😀 e\u0301\r\n"
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        for (split in 0..bytes.size) {
            val decoder = IncrementalUtf8Decoder()
            val actual = decoder.decode(bytes.copyOfRange(0, split)) +
                decoder.decode(ByteArray(0)) +
                decoder.decode(bytes.copyOfRange(split, bytes.size)) + decoder.finish()
            assertEquals("Split at byte $split", text, actual)
        }
    }

    @Test
    fun preservesUnicodeInSingleByteChunks() {
        val text = "Olá 世界 🌍"
        val decoder = IncrementalUtf8Decoder()
        val output = StringBuilder()
        for (byte in text.toByteArray(StandardCharsets.UTF_8)) {
            output.append(decoder.decode(byteArrayOf(byte)))
        }
        assertEquals(text, output.toString() + decoder.finish())
    }

    @Test
    fun buffersIncompleteSequencesUntilSessionClosure() {
        for (character in listOf("á", "€", "😀")) {
            val bytes = character.toByteArray(StandardCharsets.UTF_8)
            for (length in 1 until bytes.size) {
                val decoder = IncrementalUtf8Decoder()
                assertEquals("", decoder.decode(bytes.copyOf(length)))
                assertEquals("", decoder.decode(ByteArray(0)))
                assertEquals("\uFFFD", decoder.finish())
                assertEquals("", decoder.finish())
                assertEquals(character, decoder.decode(bytes))
                assertEquals("", decoder.finish())
            }
        }
    }

    @Test
    fun resetDiscardsBytesFromPreviousSession() {
        val decoder = IncrementalUtf8Decoder()
        assertEquals("", decoder.decode(byteArrayOf(0xF0.toByte(), 0x9F.toByte())))
        decoder.reset()
        assertEquals("nova sessão", decoder.decode("nova sessão".toByteArray(StandardCharsets.UTF_8)))
        assertEquals("", decoder.finish())
    }

    @Test
    fun malformedInputMatchesWholeStreamReplacement() {
        val bytes = byteArrayOf(
            0xC3.toByte(), 0x28, 0x80.toByte(), 0xE2.toByte(), 0x82.toByte(),
            0x41, 0xF0.toByte(), 0x9F.toByte(),
        )
        val expected = String(bytes, StandardCharsets.UTF_8)
        for (split in 0..bytes.size) {
            val decoder = IncrementalUtf8Decoder()
            val actual = decoder.decode(bytes.copyOfRange(0, split)) +
                decoder.decode(bytes.copyOfRange(split, bytes.size)) + decoder.finish()
            assertEquals("Split at byte $split", expected, actual)
        }
    }

    @Test
    fun completionMarkerStillRequiresCompleteLineAfterUnicodeOutput() {
        val marker = "__MCODE_DONE_test__"
        val prefix = "ação 😀\r\n"
        for (exitCode in listOf(0, 127, -1)) {
            val decoder = IncrementalUtf8Decoder()
            val output = StringBuilder()
            val bytes = "$prefix$marker:$exitCode\r\n".toByteArray(StandardCharsets.UTF_8)
            for (index in bytes.indices) {
                output.append(decoder.decode(byteArrayOf(bytes[index])))
                if (index < bytes.lastIndex) {
                    assertNull(findTerminalCompletion(output, marker))
                }
            }
            val completion = findTerminalCompletion(output, marker)!!
            assertEquals(exitCode, completion.exitCode)
            assertEquals(prefix, output.substring(0, completion.markerStart))
            assertEquals("", decoder.finish())
        }
    }
}
