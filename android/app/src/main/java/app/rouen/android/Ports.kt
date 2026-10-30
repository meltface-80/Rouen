package app.rouen.android

/**
 * The ports the app opens on the phone's own 127.0.0.1 (dev/design/android-app.md §4.7, §4.16). Free of Android, so a
 * JVM test (src/test) holds them apart.
 *
 * v1.9.72-t23: the built-in Tailscale had Mandarin's own port, 34500, from the code it came from. Mandarin's app keeps
 * its engine joined on that port, at home too, so with Mandarin on the phone Rouen's forward was refused (the port in
 * use) and Rouen's requests went into Mandarin's tunnel instead: Rouen couldn't be reached away, now and then.
 */
object Ports {
    /** Rouen's built-in Tailscale: the way to Rouen away ([TailscaleEngine.PORT]). */
    const val ENGINE = 34510

    /** The page's own address ([PageRelay.PORT]). */
    const val PAGE = 34600

    /** Mandarin's app's built-in Tailscale (meltface-80/Mandarin: TailscaleEngine.PORT): held while Mandarin runs. */
    const val MANDARIN_ENGINE = 34500
}
