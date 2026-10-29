import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Rouen for Android (dev/design/android-app.md §4.8): Rouen's web app in a WebView, and the
// phone's player (§4.10) in a Media3 session service. SDK, NDK and CMake versions are
// Mandarin's, so the libopus build below is the same as its.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI stamps these (.github/workflows/android.yml): the name from Rouen's package.json, the
// code from the run number, so every published build installs over the one before.
val stampedName = (project.findProperty("rouenVersionName") as String?)?.takeIf { it.isNotBlank() } ?: "0.0.0-local"
val stampedCode = (project.findProperty("rouenVersionCode") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "app.rouen.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.rouen.android"
        minSdk = 26
        targetSdk = 36
        versionCode = stampedCode
        versionName = stampedName
        // One ABI, as Mandarin's: every phone the app is for is 64-bit ARM.
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_static") } }
    }

    // Media3's Opus decoder over libopus (src/main/cpp), so Opus 256 decodes to float rather
    // than Android's 16-bit. CMake fetches libopus itself; the NDK and CMake come from the SDK
    // manager (the workflow installs them).
    ndkVersion = "27.2.12479018"
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    buildFeatures {
        buildConfig = true
    }

    // Builds without the release secrets are signed with the key committed beside this file,
    // so every build installs over the last. It is a debug key, public by design; set the
    // ROUEN_KEYSTORE_* secrets for a key nobody else holds.
    signingConfigs.getByName("debug") {
        storeFile = file("rouen-debug.keystore")
        storePassword = "android"
        keyAlias = "rouen"
        keyPassword = "android"
    }

    val keystorePath = System.getenv("ROUEN_KEYSTORE")
    if (!keystorePath.isNullOrBlank()) {
        signingConfigs.create("release") {
            storeFile = file(keystorePath)
            storePassword = System.getenv("ROUEN_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ROUEN_KEY_ALIAS") ?: "rouen"
            keyPassword = System.getenv("ROUEN_KEY_PASSWORD") ?: System.getenv("ROUEN_KEYSTORE_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    // A release build also runs Android's "lint vital" checks, which can stop the build over
    // warnings that do not change what is built.
    lint { checkReleaseBuilds = false }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/*.kotlin_module",
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*",
            "META-INF/NOTICE*"
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Window insets (the bars keep Rouen's colour, the page stays clear of them).
    implementation("androidx.core:core:1.13.1")
    // The back button on Android 13 and later (predictive back), through ComponentActivity.
    implementation("androidx.activity:activity:1.10.1")
    // The phone's player: ExoPlayer, and the media session, notification and lock screen.
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    // The Opus decoder carried in src/main/java/androidx/media3/decoder/opus builds on these.
    implementation("androidx.media3:media3-decoder:1.8.0")
    implementation("androidx.media3:media3-extractor:1.8.0")
    implementation("androidx.media3:media3-session:1.8.0")
}
