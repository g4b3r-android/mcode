

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.g4b3r.m_code"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.g4b3r.m_code"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        aidl = true
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.17.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}


val webDir = rootProject.layout.projectDirectory.dir("web")
val webDist = layout.buildDirectory.dir("web/dist")

val npmBuild by tasks.registering(Exec::class) {
    workingDir(webDir)
    commandLine("npm", "run", "build", "--", "--outDir", webDist.get().asFile.absolutePath)
    inputs.dir(webDir.dir("src"))
    inputs.files(webDir.asFileTree.matching {
        include("index.html", "package.json", "package-lock.json", "vite*.js", ".env*")
    })
    inputs.files(webDir.asFileTree.matching { include("public/**") })
    outputs.dir(webDist)
}

abstract class SyncWebAssets : Sync() {
    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty
}

androidComponents {
    onVariants { variant ->
        val variantName = variant.name.replaceFirstChar { it.uppercaseChar() }
        val copyWebBuild = tasks.register<SyncWebAssets>("copy${variantName}WebBuild") {
            dependsOn(npmBuild)
            from(webDist) { into("web") }
            into(outputDirectory)
        }
        variant.sources.assets?.addGeneratedSourceDirectory(
            copyWebBuild, SyncWebAssets::outputDirectory
        )
    }
}
