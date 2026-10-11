package com.g4b3r.m_code

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EditorNavigationTest {
    @Test fun allowsOnlyThePackagedEditorInTheMainFrame() {
        assertTrue(MainActivity.isAllowedEditorNavigation(MainActivity.EDITOR_URL, true))
        assertTrue(MainActivity.isAllowedEditorNavigation("${MainActivity.EDITOR_URL}#settings", true))
        listOf(
            "https://example.com/", "http://example.com/", "about:blank", "about:srcdoc",
            "data:text/html,<script>alert(1)</script>", "blob:https://example.com/id",
            "javascript:alert(1)", "intent://example.com", "content://provider/index.html",
            "file:///sdcard/index.html", "file:///android_asset/web/other.html",
            "${MainActivity.EDITOR_URL}.evil", "${MainActivity.EDITOR_URL}/other",
            "${MainActivity.EDITOR_URL}?next=https://example.com/",
            "https://example.com/#${MainActivity.EDITOR_URL}",
            "file://evil/android_asset/web/index.html", ""
        ).forEach { url ->
            assertFalse(url, MainActivity.isAllowedEditorNavigation(url, true))
        }
    }

    @Test fun preservesInlinePreviewButBlocksExternalFrameNavigation() {
        assertTrue(MainActivity.isAllowedEditorNavigation("about:srcdoc", false))
        assertTrue(MainActivity.isAllowedEditorNavigation("about:blank", false))
        listOf("https://example.com/", "http://example.com/", MainActivity.EDITOR_URL,
            "file:///sdcard/preview.html", "data:text/html,preview", "about:blank.evil"
        ).forEach { url ->
            assertFalse(url, MainActivity.isAllowedEditorNavigation(url, false))
        }
    }

    @Test fun doesNotTrustMissingOrPreviewPageFinishedUrls() {
        assertFalse(MainActivity.isTrustedEditorUrl(null))
        assertFalse(MainActivity.isTrustedEditorUrl("about:srcdoc"))
        assertFalse(MainActivity.isTrustedEditorUrl("https://example.com/"))
        assertTrue(MainActivity.isTrustedEditorUrl(MainActivity.EDITOR_URL))
    }
}
