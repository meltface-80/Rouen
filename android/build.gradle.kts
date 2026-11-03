// Plugin versions are declared once, here, and applied in the module that needs them.
// The same versions as Mandarin's app, so the two build alike.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
