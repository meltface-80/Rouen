package app.rouen.android

/**
 * A download folder of the owner's own choosing (dev/design/android-app.md §4.19, v1.9.72-t34; the owner, 2026-10-30:
 * "Unable to choose the folder on my phone where downloads are stored", decided "Mandarin's way"). Any folder on the
 * phone or an SD card, picked with Android's folder picker; downloads are written there as plain files, which needs
 * Android's "All files access", asked for once. Albums there outlive the app: a reinstall pointed at the same folder
 * finds them by their album.json.
 *
 * The rules, free of Android so they are tested on the JVM (src/test); [PhoneFolders] asks Android.
 */
object DownloadFolder {
    /** The place's id among the places to save to ([PhoneChoices.DOWNLOAD_LOCATION]). */
    const val PLACE = "folder"

    /** The provider of the phone's own storage and its SD cards: the only one whose folders are paths. */
    const val STORAGE = "com.android.externalstorage.documents"

    /**
     * The path of the folder picked, from its tree's provider ([authority]) and document id ([treeId]): "primary:Music"
     * is [primary]/Music, "1234-5678:Music" the SD card's /storage/1234-5678/Music, "home:Rouen" [primary]/Documents/Rouen.
     * Null for a folder of another provider (a cloud drive, Downloads' own), which has no path and can't hold downloads.
     */
    fun pathOf(authority: String?, treeId: String?, primary: String): String? {
        if (authority != STORAGE || treeId == null) return null
        val vol = treeId.substringBefore(':', "")
        if (vol.isEmpty()) return null
        val rel = treeId.substringAfter(':').trim('/')
        val root = when (vol) {
            "primary" -> primary.trimEnd('/')
            "home" -> primary.trimEnd('/') + "/Documents"
            else -> "/storage/$vol"
        }
        return if (rel.isEmpty()) root else "$root/$rel"
    }

    /**
     * Where the folder stands: "none" (none picked), "unmapped" (picked, but not a folder downloads can be written to),
     * "needed" (All files access not given yet), "away" (not there now: its card out) or "granted" (downloads go there).
     */
    fun access(chosen: Boolean, path: String?, allFiles: Boolean, isDir: Boolean): String = when {
        !chosen -> "none"
        path == null -> "unmapped"
        !allFiles -> "needed"
        !isDir -> "away"
        else -> "granted"
    }

    /**
     * The folders albums are read from, [where] first (phone storage, the SD card, or the picked folder when it is
     * there to write): every one is read, so changing where new albums go hides none.
     */
    fun <T : Any> order(where: String, phone: T, sd: T?, folder: T?): List<T> {
        val first = when (where) {
            "sd" -> sd
            PLACE -> folder
            else -> null
        } ?: phone
        return listOf(first) + listOfNotNull(phone, sd, folder).filter { it != first }
    }
}
