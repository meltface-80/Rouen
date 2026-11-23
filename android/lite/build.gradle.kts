import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Rouen Lite (dev/design/rouen-lite.md): Rouen's own server in the APK, started by Node 24 (libnode.so, from the pinned
// fogtape/nodejs-mobile build, §2.2) through the small JNI library in src/main/cpp, in a foreground service, with
// Rouen's page in a WebView. Two inputs are made by CI (.github/workflows/lite.yml), never committed:
//   src/main/jniLibs/arm64-v8a/libnode.so (and libc++_shared.so where libnode needs it), checked by SHA-256;
//   src/main/assets/rouen.zip: Rouen's server (index.js, lib/, public/, the JavaScript node_modules, lite-start.js).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// As the Rouen Android app's (android/app): CI stamps the name from package.json and the code from it.
val stampedName = (project.findProperty("rouenVersionName") as String?)?.takeIf { it.isNotBlank() } ?: "0.0.0-local"
val stampedCode = (project.findProperty("rouenVersionCode") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "app.rouen.lite"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.rouen.lite"
        minSdk = 26
        targetSdk = 36
        versionCode = stampedCode
        versionName = stampedName
        // 64-bit ARM alone for now (§3): the phones and tablets Rouen Lite is for.
        ndk { abiFilters += "arm64-v8a" }
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_STL=c++_static") } }
    }

    ndkVersion = "27.2.12479018"
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    buildFeatures { buildConfig = true }

    // The same keys as the Rouen Android app's (android/app/build.gradle.kts).
    signingConfigs.getByName("debug") {
        storeFile = file("../app/rouen-debug.keystore")
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

    lint { checkReleaseBuilds = false }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        // libnode.so unpacked onto the device as the other native libraries are; the server's zip kept as it is
        // (a stored asset reads as a stream without the build squeezing it twice).
        jniLibs.useLegacyPackaging = true
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/LICENSE*", "META-INF/NOTICE*")
    }
    androidResources { noCompress += "zip" }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.activity:activity:1.10.1")
    testImplementation("junit:junit:4.13.2")
}
