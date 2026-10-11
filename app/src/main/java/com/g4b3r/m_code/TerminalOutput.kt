package com.g4b3r.m_code

private fun quoteShell(value: String): String = "'${value.replace("'", "'\"'\"'")}'"

/** One shell input line: the PTY echoes it before the start marker is printed. */
internal fun buildTerminalCommand(
    command: String,
    directory: String,
    startMarker: String,
    doneMarker: String,
): String = "printf '\\n%s\\n' ${quoteShell(startMarker)}; " +
    "if cd -- ${quoteShell(directory)}; then eval ${quoteShell(command)}; else false; fi; " +
    "printf '\\n%s:%s\\n' ${quoteShell(doneMarker)} \"$?\"\n"

private val terminalEscapes = Regex(
    "\u001B\\][^\u0007\u001B]*(?:\u0007|\u001B\\\\)|" +
        "\u001B[P^_X][\\s\\S]*?\u001B\\\\|" +
        "(?:\u001B\\[|\u009B)[0-?]*[ -/]*[@-~]|\u001B[@-_]"
)

/** Plain-text transcript; keep program errors, remove only terminal protocol/formatting. */
internal fun cleanTerminalOutput(raw: String, startMarker: String): String {
    val plain = terminalEscapes.replace(raw, "").replace("\r\n", "\n")
    val start = Regex("(?m)^${Regex.escape(startMarker)}\\n").find(plain)
    val content = if (start != null) plain.substring(start.range.last + 1) else plain
    val result = StringBuilder()
    val line = StringBuilder()
    var cursor = 0
    for (char in content) {
        when (char) {
            '\n' -> {
                result.append(line).append('\n')
                line.setLength(0)
                cursor = 0
            }
            '\r' -> cursor = 0
            '\b' -> cursor = (cursor - 1).coerceAtLeast(0)
            else -> if (char == '\t' || (char >= ' ' && char != '\u007f')) {
                if (cursor < line.length) line.setCharAt(cursor, char) else line.append(char)
                cursor++
            }
        }
    }
    return result.append(line).toString().trimEnd('\n')
}
