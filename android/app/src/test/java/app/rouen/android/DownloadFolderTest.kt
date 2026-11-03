package app.rouen.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The download folder of the owner's choosing (dev/design/android-app.md §4.19, v1.9.72-t34). The owner, 2026-10-30:
 * "Unable to choose the folder on my phone where downloads are stored".
 */
class DownloadFolderTest {
    private val primary = "/storage/emulated/0"

    @Test fun THE_ONE_aFolderPickedOnThePhoneOrItsCardIsItsPath() {
        assertEquals("/storage/emulated/0/Music/Rouen", DownloadFolder.pathOf(DownloadFolder.STORAGE, "primary:Music/Rouen", primary))
        assertEquals("/storage/1234-5678/Music", DownloadFolder.pathOf(DownloadFolder.STORAGE, "1234-5678:Music", primary))
        assertEquals("the whole of the phone's storage", primary, DownloadFolder.pathOf(DownloadFolder.STORAGE, "primary:", primary))
        assertEquals("Documents, as the picker's own root names it", "/storage/emulated/0/Documents/Rouen",
            DownloadFolder.pathOf(DownloadFolder.STORAGE, "home:Rouen", primary))
    }

    @Test fun aFolderOfAnotherProviderHasNoPath() {
        assertNull("a cloud drive", DownloadFolder.pathOf("com.google.android.apps.docs.storage", "acc=1;doc=abc", primary))
        assertNull("Downloads' own provider", DownloadFolder.pathOf("com.android.providers.downloads.documents", "downloads", primary))
        assertNull("a tree id with no volume", DownloadFolder.pathOf(DownloadFolder.STORAGE, "Music", primary))
        assertNull(DownloadFolder.pathOf(DownloadFolder.STORAGE, null, primary))
    }

    @Test fun THE_ONE_forAccess_downloadsGoThereOnlyWithAllFilesAccessAndTheFolderThere() {
        assertEquals("none", DownloadFolder.access(chosen = false, path = null, allFiles = true, isDir = false))
        assertEquals("unmapped", DownloadFolder.access(chosen = true, path = null, allFiles = true, isDir = false))
        assertEquals("needed", DownloadFolder.access(chosen = true, path = "/x", allFiles = false, isDir = true))
        // Without the access a folder that is there can't be seen: asked for, not said to be away.
        assertEquals("needed", DownloadFolder.access(chosen = true, path = "/x", allFiles = false, isDir = false))
        assertEquals("away", DownloadFolder.access(chosen = true, path = "/x", allFiles = true, isDir = false))
        assertEquals("granted", DownloadFolder.access(chosen = true, path = "/x", allFiles = true, isDir = true))
    }

    @Test fun newAlbumsGoWhereChosenAndEveryPlaceIsStillRead() {
        assertEquals(listOf("F", "P", "S"), DownloadFolder.order(DownloadFolder.PLACE, "P", "S", "F"))
        assertEquals(listOf("S", "P", "F"), DownloadFolder.order("sd", "P", "S", "F"))
        assertEquals(listOf("P", "S", "F"), DownloadFolder.order("phone", "P", "S", "F"))
        assertEquals("the folder not there to write: phone storage", listOf("P", "S"), DownloadFolder.order(DownloadFolder.PLACE, "P", "S", null))
        assertEquals(listOf("P"), DownloadFolder.order("sd", "P", null, null))
    }
}
