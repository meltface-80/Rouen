package app.rouen.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

/**
 * The page's downloads as the app takes them (SavedFile.kt, dev/design/android-app.md §4.17, v1.9.72-t23): the three
 * kinds the page offers, as they are named, and nothing that could leave Downloads/Rouen.
 */
class SavedFileTest {
    private fun b64(s: String) = Base64.getEncoder().encodeToString(s.toByteArray())

    @Test fun `the three the page offers, byte for byte, filed as text or JSON`() {
        val playlist = SavedFile.accept(b64("MDRP1:ZmFrZQ"), "Late_Night.musicd")
        assertNotNull(playlist)
        assertEquals("Late_Night.musicd", playlist!!.name)
        assertEquals("text/plain", playlist.mime)
        assertArrayEquals("MDRP1:ZmFrZQ".toByteArray(), playlist.bytes)
        assertEquals("text/plain", SavedFile.accept(b64("scan: 3 labels\n"), "labels-scan.log")!!.mime)
        val backup = SavedFile.accept(b64("{\"backup\":1}"), "rouen-backup-20261030-120000.json")!!
        assertEquals("rouen-backup-20261030-120000.json", backup.name)
        assertEquals("application/json", backup.mime)
    }

    @Test fun `an empty file is a file`() {
        assertEquals(0, SavedFile.accept("", "empty.log")!!.bytes.size)
    }

    @Test fun `no folder in the name, and no kind the page doesn't offer`() {
        assertEquals("passwd.json", SavedFile.safeName("../../etc/passwd.json"))
        assertEquals("x.log", SavedFile.safeName("C:\\Users\\me\\x.log"))
        assertEquals("bashrc.txt", SavedFile.safeName(".bashrc.txt"))
        assertEquals("a_b.json", SavedFile.safeName("a b.JSON"))
        assertNull(SavedFile.safeName("app.apk"))
        assertNull(SavedFile.safeName("noending"))
        assertNull(SavedFile.safeName(".json"))
        assertNull(SavedFile.safeName(""))
        assertNull(SavedFile.safeName(null))
        assertEquals(95, SavedFile.safeName("x".repeat(300) + ".json")!!.length)
    }

    @Test fun `refused, with why`() {
        assertNull(SavedFile.accept(b64("x"), "app.apk"))
        assertEquals("the app doesn't save that kind of file", SavedFile.refusal(b64("x"), "notes"))
        assertNull(SavedFile.accept("%%% not base64 %%%", "x.log"))
        assertEquals("that file couldn't be read", SavedFile.refusal("%%% not base64 %%%", "x.log"))
        assertEquals("that file's name can't be saved", SavedFile.refusal(b64("x"), "../"))
        assertNull(SavedFile.accept(null, "x.log"))
        assertNull(SavedFile.decode("A".repeat(SavedFile.MAX_BYTES / 3 * 4 + 8)))
    }
}
