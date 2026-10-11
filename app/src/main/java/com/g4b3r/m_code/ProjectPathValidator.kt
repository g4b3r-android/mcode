package com.g4b3r.m_code

internal object ProjectPathValidator {
    private val absolutePrefix = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")

    fun components(relativePath: String): List<String>? {
        val path = relativePath.replace('\\', '/')
        if (path.isBlank() || path.startsWith('/') || absolutePrefix.containsMatchIn(path)) return null
        if (path.any { it.isISOControl() }) return null

        val parts = path.split('/')
        if (parts.any { it.isBlank() || it == "." || it == ".." }) return null
        return parts
    }
}
