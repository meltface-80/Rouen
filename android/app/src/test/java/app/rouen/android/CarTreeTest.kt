package app.rouen.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Android Auto's tree (CarTree.kt, dev/design/android-app.md §4.24, v1.9.72-t81). The owner, 2026-11-03: "add Android
 * auto support to the app Mandarin has this"; the folders Recently played, Smart Picks, Random albums, Library A–Z,
 * Playlists and Downloaded albums; albums only.
 */
class CarTreeTest {
    @Test fun `THE one - the owner's folders, in order, Rouen's only when Rouen can be used`() {
        assertEquals(listOf("recent", "picks", "random", "library", "playlists", "downloads"), CarTree.root(true).map { it.first })
        assertEquals(listOf("Recently played", "Smart Picks", "Random albums", "Library A–Z", "Playlists", "Downloaded albums"),
            CarTree.root(true).map { it.second })
        assertEquals(listOf("downloads"), CarTree.root(false).map { it.first })
    }

    @Test fun `albums are read by their place and names, one with no place in Roon's list is left out`() {
        val j = JSONObject("""{"albums":[
            {"offset":4,"title":"Heathen","subtitle":"David Bowie","image_key":"k4"},
            {"offset":null,"title":"Gone","subtitle":"Nobody"},
            {"offset":9,"title":"Low","subtitle":"David Bowie","image_key":null}]}""")
        assertEquals(listOf(CarTree.Row(4, "Heathen", "David Bowie", "k4"), CarTree.Row(9, "Low", "David Bowie", "")), CarTree.albums(j))
        assertEquals(emptyList<CarTree.Row>(), CarTree.albums(null))
        assertEquals(listOf(CarTree.Row(2, "Mix", "", "p")),
            CarTree.albums(JSONObject("""{"playlists":[{"offset":2,"title":"Mix","image_key":"p"}]}"""), "playlists"))
    }

    @Test fun `Smart Picks - only those in the library, by the library's own names`() {
        val j = JSONObject("""{"picks":[
            {"album":"Hounds","artist":"Kate Bush","offset":12,"library_title":"Hounds of Love","library_subtitle":"Kate Bush","image_key":"h"},
            {"album":"Elsewhere","artist":"Someone","offset":null,"library_title":"","image_key":null}]}""")
        assertEquals(listOf(CarTree.Row(12, "Hounds of Love", "Kate Bush", "h")), CarTree.picks(j))
    }

    @Test fun `the library A-Z in runs of a hundred, each titled by its first and last album`() {
        val all = (0 until 250).map { CarTree.Row(it, "Album %03d".format(it), "", "") }
        val c = CarTree.chunks(all)
        assertEquals(listOf("lib:0", "lib:100", "lib:200"), c.map { it.id })
        assertEquals(listOf(0 to 100, 100 to 200, 200 to 250), c.map { it.from to it.until })
        assertEquals("Album 000 – Album 099", c[0].title)
        assertEquals(emptyList<CarTree.Chunk>(), CarTree.chunks(emptyList()))
    }

    @Test fun `an id says what it is`() {
        assertEquals(CarTree.ALBUM to "4", CarTree.kind("al:4"))
        assertEquals(CarTree.PLAYLIST to "2", CarTree.kind("pl:2"))
        assertEquals(CarTree.DOWNLOAD to "heathen-bowie", CarTree.kind("dl:heathen-bowie"))
        assertEquals(CarTree.CHUNK to "100", CarTree.kind("lib:100"))
        assertEquals("" to "recent", CarTree.kind("recent"))
    }
}
