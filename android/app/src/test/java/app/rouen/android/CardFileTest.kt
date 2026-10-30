package app.rouen.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

/**
 * The share card as the page hands it to the app (CardFile.kt, dev/design/android-app.md §4.17): only a PNG is taken,
 * and the page names the file but never its folder.
 */
class CardFileTest {
    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3)
    private fun b64(b: ByteArray) = Base64.getEncoder().encodeToString(b)

    @Test fun `the page's base64 is the card's PNG, byte for byte`() {
        assertArrayEquals(png, CardFile.decode(b64(png)))
    }

    @Test fun `base64 broken over lines, as a data URL's can be, is taken`() {
        assertArrayEquals(png, CardFile.decode(Base64.getMimeEncoder(4, "\n".toByteArray()).encodeToString(png)))
    }

    @Test fun `not a PNG, not base64, nothing or too big - refused`() {
        assertNull(CardFile.decode(b64("<html>not a picture</html>".toByteArray())))
        assertNull(CardFile.decode("%%% not base64 %%%"))
        assertNull(CardFile.decode(""))
        assertNull(CardFile.decode(null))
        assertNull(CardFile.decode(b64(png + ByteArray(CardFile.MAX_BYTES))))
    }

    @Test fun `the page's name, as it gives it`() {
        assertEquals("Bruce_Springsteen-Western_Stars.png", CardFile.safeName("Bruce_Springsteen-Western_Stars.png"))
    }

    @Test fun `no folder, no hidden file, nothing but a png`() {
        assertEquals("passwd.png", CardFile.safeName("../../etc/passwd"))
        assertEquals("evil.png", CardFile.safeName("C:\\Users\\x\\evil.png"))
        assertEquals("profile.png", CardFile.safeName(".profile"))
        assertEquals("a_b_c.png", CardFile.safeName("a b c"))
        assertEquals("card.exe.png", CardFile.safeName("card.exe"))
        assertEquals("card.png", CardFile.safeName(""))
        assertEquals("card.png", CardFile.safeName(null))
        assertEquals(94, CardFile.safeName("x".repeat(300)).length)
    }
}
