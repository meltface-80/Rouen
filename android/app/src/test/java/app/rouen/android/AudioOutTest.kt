package app.rouen.android

import android.media.AudioDeviceInfo
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Where the phone's sound goes, in words, for the app's log (AudioOut.kt, dev/design/android-app.md §4.13, v2.0.1-t1).
 * The owner's stutter of 2026-11-03 was on Bluetooth earbuds set to AAC, with no underrun in the app's log, and the log
 * did not say where the sound went.
 */
class AudioOutTest {
    @Test fun `THE one - Bluetooth earbuds are Bluetooth (A2DP)`() {
        assertEquals("Bluetooth (A2DP)", AudioOut.kind(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP))
    }

    @Test fun `LE Audio, wired, USB and the speaker each have their word`() {
        assertEquals("Bluetooth LE Audio", AudioOut.kind(26))
        assertEquals("wired", AudioOut.kind(AudioDeviceInfo.TYPE_WIRED_HEADPHONES))
        assertEquals("wired", AudioOut.kind(AudioDeviceInfo.TYPE_WIRED_HEADSET))
        assertEquals("USB", AudioOut.kind(AudioDeviceInfo.TYPE_USB_HEADSET))
        assertEquals("USB", AudioOut.kind(AudioDeviceInfo.TYPE_USB_DEVICE))
        assertEquals("the phone's speaker", AudioOut.kind(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
    }

    @Test fun `a type it does not know is given by its number`() {
        assertEquals("type 999", AudioOut.kind(999))
    }

    @Test fun `several outputs of one kind are said once, in order`() {
        assertEquals("Bluetooth (A2DP), the phone's speaker",
            AudioOut.kinds(listOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, 24)))
    }
}
