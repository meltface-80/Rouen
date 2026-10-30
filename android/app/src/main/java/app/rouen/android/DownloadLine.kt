package app.rouen.android

import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Downloads one at a time, on [pool]'s one thread, and Remove that never waits behind them (dev/design/android-app.md
 * §4.19, v1.9.72-t30). Until then a removal was queued on the same thread as the downloads, so removing one album
 * waited for the whole of another's download (the owner: "the remove button failed but removing the snow patrol album
 * did remove both"). Free of Android, so it is tested on the JVM (src/test).
 */
class DownloadLine(
    private val pool: ScheduledExecutorService,
    /** Something to do, where there was nothing: the foreground service is held ([DownloadService], v1.9.72-t30). */
    private val busy: () -> Unit = {},
    /** Nothing more to do: it is let go. */
    private val idle: () -> Unit = {}
) {
    /** Downloads queued or running, a retry's wait among them. */
    private val pending = java.util.concurrent.atomic.AtomicInteger(0)

    /** The album downloading now, if any. */
    @Volatile var active: String? = null
        private set
    @Volatile private var stopped: String? = null

    /** [job] for album [key], after the downloads before it. */
    fun run(key: String, job: () -> Unit) { took(); pool.execute { step(key, job) } }

    /** [job] for album [key], [seconds] from now. */
    fun later(key: String, seconds: Long, job: () -> Unit) { took(); pool.schedule({ step(key, job) }, seconds, TimeUnit.SECONDS) }

    /** Something to do on the line's thread, after what is there. */
    fun then(job: () -> Unit) { pool.execute(job) }

    /** Album [key] is to stop: its download looks between two reads. */
    fun cancelled(key: String): Boolean = stopped == key

    /** Album [key] asked for again: no longer stopped. */
    fun asked(key: String) { if (stopped == key) stopped = null }

    /**
     * Album [key] removed: [delete] at once, on the caller's thread, unless it is the album downloading. That one is
     * stopped first, and deleted on the line once its download has let go of its files.
     */
    fun remove(key: String, delete: () -> Unit) {
        stopped = key
        if (active == key) pool.execute(delete) else delete()
    }

    private fun took() { if (pending.getAndIncrement() == 0) busy() }

    private fun step(key: String, job: () -> Unit) {
        active = key
        try { job() } finally {
            active = null
            if (pending.decrementAndGet() == 0) idle()
        }
    }
}
