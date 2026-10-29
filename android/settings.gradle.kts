// Rouen for Android (dev/design/android-app.md §4.8): its own Gradle root, beside the
// Node server, so nothing here touches the server's build. Arrangement from Mandarin's app.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "RouenAndroid"
include(":app")
