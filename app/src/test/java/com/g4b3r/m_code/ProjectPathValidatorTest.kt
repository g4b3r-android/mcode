package com.g4b3r.m_code

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProjectPathValidatorTest {
    @Test fun rejectsEmptyAndMalformedPaths() {
        listOf("", " ", "\t", "src//main.kt", "src/", "src/ /main.kt",
            "src/\u0000main.kt", "src/main\n.kt", "src/main\u007f.kt",
            "src\\\\main.kt", "src\\").forEach { path ->
            assertNull(path, ProjectPathValidator.components(path))
        }
    }

    @Test fun rejectsAbsolutePathsAndUris() {
        listOf("/main.kt", "/storage/emulated/0/main.kt", "//server/share/main.kt",
            "\\main.kt", "\\\\server\\share\\main.kt", "C:\\src\\main.kt",
            "C:/src/main.kt", "C:main.kt", "file:///tmp/main.kt",
            "content://provider/tree/project/main.kt").forEach { path ->
            assertNull(path, ProjectPathValidator.components(path))
        }
    }

    @Test fun rejectsDotComponentsWithoutNormalizingThemAway() {
        listOf(".", "..", "./main.kt", "../main.kt", "src/../main.kt",
            "src/./main.kt", "src/..", "src/.", "src\\..\\main.kt",
            "src\\.\\main.kt", "src/ok/../../main.kt").forEach { path ->
            assertNull(path, ProjectPathValidator.components(path))
        }
    }

    @Test fun preservesLegitimateNamesAndNestedDirectories() {
        listOf("main.kt", "src/main/kotlin/Main.kt", "projeto ação/d'água.txt",
            ".config/.env", "src/file..txt", ".../main.kt", " pasta / arquivo.txt ",
            "src/100% pronto.txt", "src/a:b.txt").forEach { path ->
            assertEquals(path, path.split('/'), ProjectPathValidator.components(path))
        }
        assertEquals(listOf("src", "main", "Main.kt"),
            ProjectPathValidator.components("src\\main/Main.kt"))
    }
}
