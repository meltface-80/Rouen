package app.rouen.android

import androidx.annotation.OptIn
import androidx.media3.common.Format
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import java.io.IOException

/**
 * The phone's player in the app's log (PLAYER, dev/design/android-app.md §4.13, v1.9.72-t11): what ExoPlayer does,
 * from its own analytics — its state and play-when-ready with the reason, the audio's format and its decoder, the audio
 * track it opened, each load's end and its errors, underruns, and every error with its cause chain. The owner's
 * lossless report (a few seconds, then the next track) is the kind of thing these lines are for. Nothing while the log
 * is off (each line is dropped at once).
 */
@OptIn(UnstableApi::class)
class PlayerLog : AnalyticsListener {

    private fun state(s: Int) = when (s) {
        Player.STATE_IDLE -> "IDLE"
        Player.STATE_BUFFERING -> "BUFFERING"
        Player.STATE_READY -> "READY"
        Player.STATE_ENDED -> "ENDED"
        else -> "state $s"
    }

    private fun reason(r: Int) = when (r) {
        Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST -> "asked"
        Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS -> "audio focus lost"
        Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY -> "headphones out"
        Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE -> "remote"
        Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM -> "end of the item"
        Player.PLAY_WHEN_READY_CHANGE_REASON_SUPPRESSED_TOO_LONG -> "suppressed too long"
        else -> "reason $r"
    }

    private fun at(t: AnalyticsListener.EventTime) = "at ${t.currentPlaybackPositionMs} ms, buffered ${t.totalBufferedDurationMs} ms"

    override fun onPlaybackStateChanged(eventTime: AnalyticsListener.EventTime, state: Int) {
        AppLog.line("PLAYER", "state ${state(state)}, ${at(eventTime)}", anomaly = state == Player.STATE_ENDED)
    }

    override fun onPlayWhenReadyChanged(eventTime: AnalyticsListener.EventTime, playWhenReady: Boolean, reason: Int) {
        AppLog.line("PLAYER", (if (playWhenReady) "play" else "pause") + " when ready (${reason(reason)}), ${at(eventTime)}")
    }

    override fun onIsPlayingChanged(eventTime: AnalyticsListener.EventTime, isPlaying: Boolean) {
        AppLog.line("PLAYER", (if (isPlaying) "sound playing" else "sound stopped") + ", ${at(eventTime)}")
    }

    override fun onPlayerError(eventTime: AnalyticsListener.EventTime, error: PlaybackException) {
        AppLog.line("PLAYER", "error ${error.errorCodeName}: ${chain(error)}, ${at(eventTime)}", anomaly = true)
    }

    override fun onAudioInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format, decoderReuseEvaluation: DecoderReuseEvaluation?) {
        AppLog.line("PLAYER", "audio: ${format.sampleMimeType ?: "?"} ${format.sampleRate} Hz, ${format.channelCount} channels" +
            (if (format.pcmEncoding != Format.NO_VALUE) ", PCM encoding ${format.pcmEncoding}" else "") +
            (format.codecs?.let { ", codecs $it" } ?: "") +
            (if (format.averageBitrate != Format.NO_VALUE) ", ${format.averageBitrate / 1000} kbps" else ""))
    }

    override fun onAudioDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String, initializedTimestampMs: Long, initializationDurationMs: Long) {
        AppLog.line("PLAYER", "decoder $decoderName, ready in $initializationDurationMs ms")
    }

    override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
        AppLog.line("PLAYER", "audio track: ${audioTrackConfig.sampleRate} Hz, encoding ${audioTrackConfig.encoding}, " +
            "channel mask ${audioTrackConfig.channelConfig}, buffer ${audioTrackConfig.bufferSize} B" +
            (if (audioTrackConfig.offload) ", offloaded" else ""))
    }

    override fun onAudioUnderrun(eventTime: AnalyticsListener.EventTime, bufferSize: Int, bufferSizeMs: Long, elapsedSinceLastFeedMs: Long) {
        AppLog.line("PLAYER", "underrun: the audio ran dry (buffer $bufferSizeMs ms, $elapsedSinceLastFeedMs ms since it was last fed), ${at(eventTime)}", anomaly = true)
    }

    override fun onAudioSinkError(eventTime: AnalyticsListener.EventTime, audioSinkError: Exception) {
        AppLog.line("PLAYER", "audio output error: ${chain(audioSinkError)}", anomaly = true)
    }

    override fun onAudioCodecError(eventTime: AnalyticsListener.EventTime, audioCodecError: Exception) {
        AppLog.line("PLAYER", "decoder error: ${chain(audioCodecError)}", anomaly = true)
    }

    override fun onLoadCompleted(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo, mediaLoadData: MediaLoadData) {
        AppLog.line("PLAYER", "load ended: ${loadEventInfo.bytesLoaded} B in ${loadEventInfo.loadDurationMs} ms, ${at(eventTime)}")
    }

    override fun onLoadError(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo, mediaLoadData: MediaLoadData, error: IOException, wasCanceled: Boolean) {
        AppLog.line("PLAYER", "load failed after ${loadEventInfo.bytesLoaded} B" + (if (wasCanceled) " (cancelled)" else "") + ": ${chain(error)}, ${at(eventTime)}", anomaly = !wasCanceled)
    }

    /** An error and its causes, each "Class: message", at most five deep. */
    private fun chain(e: Throwable): String {
        val parts = ArrayList<String>()
        var t: Throwable? = e
        while (t != null && parts.size < 5) {
            parts += t.javaClass.simpleName + (t.message?.let { ": $it" } ?: "")
            t = t.cause.takeIf { it !== t }
        }
        return parts.joinToString(" ← ")
    }
}
