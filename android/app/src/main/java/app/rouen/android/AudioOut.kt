package app.rouen.android

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build

/**
 * Where the phone's sound goes, for the app's log (PLAYER, dev/design/android-app.md §4.13, v2.0.1-t1): Bluetooth, wired,
 * USB or the phone's speaker — the kind only, never a device's name (its name is the owner's earbuds', and personal).
 * The owner's stutter of 2026-11-03 (Bluetooth earbuds on AAC) had no underrun in the app: the gaps were after it, and
 * the log did not say where the sound was going.
 *
 * Android 13 and later say which output music is routed to; before, only what is connected is known, so the line says
 * so ("connected: …"). A Bluetooth codec (AAC, LDAC) is not something an app can read.
 */
object AudioOut {

    /** A device type's kind, in words. Types newer than the app's minimum are given by their numbers. */
    fun kind(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth (A2DP)"
        26, 27, 30 -> "Bluetooth LE Audio"            // TYPE_BLE_HEADSET, TYPE_BLE_SPEAKER, TYPE_BLE_BROADCAST
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth (call audio)"
        23 -> "a hearing aid"                         // TYPE_HEARING_AID
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_LINE_ANALOG, AudioDeviceInfo.TYPE_AUX_LINE -> "wired"
        AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, 24 -> "the phone's speaker"   // 24: TYPE_BUILTIN_SPEAKER_SAFE
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "the phone's earpiece"
        AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, 29 -> "HDMI"   // 29: TYPE_HDMI_EARC
        AudioDeviceInfo.TYPE_LINE_DIGITAL -> "digital line out"
        AudioDeviceInfo.TYPE_DOCK -> "a dock"
        else -> "type $type"
    }

    /** The kinds, each once, in the order given. */
    fun kinds(types: List<Int>): String = types.map(::kind).distinct().joinToString(", ")

    /** Where music goes now: "to …" (Android 13 and later), or "connected: …"; null when Android will not say. */
    fun now(context: Context): String? = try {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= 33) {
            val music = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
            am.getAudioDevicesForAttributes(music).map { it.type }.takeIf { it.isNotEmpty() }?.let { "to " + kinds(it) }
        } else {
            am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.takeIf { it.isNotEmpty() }?.let { "connected: " + kinds(it) }
        }
    } catch (e: RuntimeException) {
        null   // Android would not say: the line goes without where the sound went, the rest of it as true
    }
}
