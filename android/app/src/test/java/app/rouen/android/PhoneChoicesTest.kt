package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The page's settings inside the app (PhoneChoices.kt): which keys and values RouenPhone.set takes. */
class PhoneChoicesTest {
    private val phoneOnly = listOf("phone")
    private val withCard = listOf("phone", "sd")

    @Test fun `the defaults are Opus 256 home and away, original files to the phone on Wi-Fi with no limit`() {
        assertEquals("opus", PhoneChoices.DEFAULTS[PhoneChoices.HOME_QUALITY])
        assertEquals("opus", PhoneChoices.DEFAULTS[PhoneChoices.AWAY_QUALITY])
        assertEquals("original", PhoneChoices.DEFAULTS[PhoneChoices.DOWNLOAD_QUALITY])
        assertEquals("phone", PhoneChoices.DEFAULTS[PhoneChoices.DOWNLOAD_LOCATION])
        assertEquals(true, PhoneChoices.DEFAULTS[PhoneChoices.DOWNLOAD_WIFI_ONLY])
        assertEquals(0, PhoneChoices.DEFAULTS[PhoneChoices.DOWNLOAD_LIMIT_GB])
        assertEquals(PhoneChoices.KEYS.toSet(), PhoneChoices.DEFAULTS.keys)
    }

    @Test fun `streaming is opus or lossless, downloads original or opus`() {
        assertEquals("lossless", PhoneChoices.parse(PhoneChoices.HOME_QUALITY, "lossless", phoneOnly))
        assertEquals("opus", PhoneChoices.parse(PhoneChoices.AWAY_QUALITY, "opus", phoneOnly))
        assertNull(PhoneChoices.parse(PhoneChoices.AWAY_QUALITY, "original", phoneOnly))
        assertEquals("opus", PhoneChoices.parse(PhoneChoices.DOWNLOAD_QUALITY, "opus", phoneOnly))
        assertNull(PhoneChoices.parse(PhoneChoices.DOWNLOAD_QUALITY, "lossless", phoneOnly))
    }

    @Test fun `the SD card only when there is one`() {
        assertEquals("sd", PhoneChoices.parse(PhoneChoices.DOWNLOAD_LOCATION, "sd", withCard))
        assertNull(PhoneChoices.parse(PhoneChoices.DOWNLOAD_LOCATION, "sd", phoneOnly))
        assertEquals("phone", PhoneChoices.parse(PhoneChoices.DOWNLOAD_LOCATION, "phone", phoneOnly))
    }

    @Test fun `Wi-Fi only is true or false, the limit one of the sizes offered`() {
        assertEquals(false, PhoneChoices.parse(PhoneChoices.DOWNLOAD_WIFI_ONLY, "false", phoneOnly))
        assertEquals(true, PhoneChoices.parse(PhoneChoices.DOWNLOAD_WIFI_ONLY, "true", phoneOnly))
        assertNull(PhoneChoices.parse(PhoneChoices.DOWNLOAD_WIFI_ONLY, "yes", phoneOnly))
        assertEquals(64, PhoneChoices.parse(PhoneChoices.DOWNLOAD_LIMIT_GB, "64", phoneOnly))
        assertEquals(0, PhoneChoices.parse(PhoneChoices.DOWNLOAD_LIMIT_GB, "0", phoneOnly))
        assertNull(PhoneChoices.parse(PhoneChoices.DOWNLOAD_LIMIT_GB, "10", phoneOnly))
        assertNull(PhoneChoices.parse(PhoneChoices.DOWNLOAD_LIMIT_GB, "lots", phoneOnly))
    }

    @Test fun `an unknown key is refused, and said so`() {
        assertNull(PhoneChoices.parse("network", "home", phoneOnly))
        assertEquals("unknown setting: network", PhoneChoices.refusal("network", "home"))
        assertEquals("downloadLimitGb cannot be \"10\"", PhoneChoices.refusal(PhoneChoices.DOWNLOAD_LIMIT_GB, "10"))
    }

    @Test fun `hello asks for home's quality at home and away's over the tailnet`() {
        assertEquals(PhoneChoices.HOME_QUALITY, PhoneChoices.streamKey(Way.Kind.HOME))
        assertEquals(PhoneChoices.AWAY_QUALITY, PhoneChoices.streamKey(Way.Kind.DIRECT))
        assertEquals(PhoneChoices.AWAY_QUALITY, PhoneChoices.streamKey(Way.Kind.ENGINE))
        assertEquals("before the first look: home's", PhoneChoices.HOME_QUALITY, PhoneChoices.streamKey(null))
    }

    @Test fun `the network word for the page`() {
        assertEquals("home", PhoneChoices.network(Way.Kind.HOME, hasNetwork = true))
        assertEquals("away", PhoneChoices.network(Way.Kind.ENGINE, hasNetwork = true))
        assertEquals("away", PhoneChoices.network(Way.Kind.DIRECT, hasNetwork = true))
        assertEquals("offline", PhoneChoices.network(Way.Kind.HOME, hasNetwork = false))
        assertEquals("offline", PhoneChoices.network(null, hasNetwork = true))
    }
}
