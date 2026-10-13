package com.g4b3r.m_code

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/** Keeps incomplete UTF-8 sequences between chunks. Calls must be serialized. */
internal class IncrementalUtf8Decoder {
    private val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPLACE)
        .onUnmappableCharacter(CodingErrorAction.REPLACE)
    private var remaining = ByteArray(0)

    fun decode(data: ByteArray): String = decode(data, endOfInput = false)

    /** Replaces a truncated final sequence and prepares for a new session. */
    fun finish(): String = decode(ByteArray(0), endOfInput = true)

    fun reset() {
        decoder.reset()
        remaining = ByteArray(0)
    }

    private fun decode(data: ByteArray, endOfInput: Boolean): String {
        val input = ByteBuffer.wrap(if (remaining.isEmpty()) data else remaining + data)
        // UTF-8 produces at most one UTF-16 code unit per input byte.
        // Android's decoder may retain bytes internally and emit them only on flush.
        val output = CharBuffer.allocate(input.remaining() + 2)
        decoder.decode(input, output, endOfInput)
        remaining = ByteArray(input.remaining()).also { input.get(it) }
        if (endOfInput) {
            decoder.flush(output)
            reset()
        }
        output.flip()
        return output.toString()
    }
}
