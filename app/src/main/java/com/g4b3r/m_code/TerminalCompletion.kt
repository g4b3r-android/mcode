package com.g4b3r.m_code

internal data class TerminalCompletion(val markerStart: Int, val exitCode: Int)

/** Ignore PTY command echoes and wait for a complete marker/status line. */
internal fun findTerminalCompletion(output: CharSequence, marker: String): TerminalCompletion? {
    val match = Regex("(?m)^${Regex.escape(marker)}:(-?\\d+)\\r?\\n")
        .find(output) ?: return null
    val exitCode = match.groupValues[1].toIntOrNull() ?: return null
    return TerminalCompletion(match.range.first, exitCode)
}
