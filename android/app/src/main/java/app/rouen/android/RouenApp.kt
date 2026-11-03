package app.rouen.android

import android.app.Application

/**
 * The app's process: its log started first (AppLog, §4.13), so a crash anywhere after this, and every line of every
 * screen and service, is caught while logging is on.
 */
class RouenApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppLog.start(this)
        AppLog.line("APP", "started: Rouen for Android ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
    }
}
