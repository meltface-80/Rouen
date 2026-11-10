# Editing a Roon playlist's tracks: reorder and remove

The owner, 2026-11-10: "And yes and edit function to edit the playlist that exists is definitely needed so tracks can
be deleted or moved within the playlist", and later the same day, on t11: "I don't see a way to reorder tracks or delete
tracks from playlists". Rouen can make a Roon playlist, add to it, rename and delete it (native mode, N2d,
`native-remote.md` §11), but not change the tracks already in it.

Every change here is a write to the owner's Roon library through Roon's private protocol, so it goes as
`roon-native.md` allows: the methods sourced, put on the allowlist one by one, tried once by hand (a probe) on a
playlist the probe makes and deletes itself, and only then built on what that run shows.

## 1. What the user sees (the owner's choices, 2026-11-10)

- **An edit mode.** On a Roon playlist's page (one of the owner's own, not read-only, native mode on), the ⋯ menu has
  **Edit playlist** beside Rename and Delete. It turns the page into edit mode: each row gets a red **−** on its left
  and a **≡** drag handle on its right, and the top block's buttons give way to **Done**. A tap on a row plays nothing
  while editing, so a track is never started by mistake. Edit mode shows the playlist in its own order (the Sort is set
  to Playlist order, and the find and the A–Z slider are put away); Done brings them back.
- **Moving.** A row is dragged by its ≡ (a finger, or a mouse) and dropped between two others; it moves there in Roon.
- **Removing asks first** (the owner's choice: "Ask first", not an undo): − asks "Remove *title* from this playlist?"
  with Cancel and Remove; Remove takes it out of Roon's playlist.
- Each change is made at once, and believed when the playlist read back shows it; one that does not show is undone on
  the page and said ("Roon didn't take that change").

## 2. The methods (`arthursoares/roon-api-reverse-engineering`, `catalog.authoritative.json`)

- `Playlists::MoveItems(Playlist, IEnumerable<PlaylistItem>, InsertionPoint, PlaylistItem, ResultCallback)`: the items
  moved, together, to before or after one item. (`MoveItem`, for one, is its twin; `MoveItems` with one item is used.)
- `Playlists::RemoveItems(Playlist, IEnumerable<PlaylistItem>)`: no callback in the catalogue, so no answer comes; what
  it did is read back.
- `InsertionPoint` is the enum `InsertTracks` sends (Beginning 0, End 1, After 2, Before 3; `args.js`).
- The items are `PlaylistItem` objects of this connection, from `Playlist::VirtualItemsQuery` (proven: it plays and
  reads Roon's playlists, `playlist-items.js`). An item is sent by reference; a collection is framed as `InsertTracks`'s
  tracks are (proven).

Neither method has been run, upstream or by Rouen.

## 3. Stage 0 — the probe (2.0.4-t12; run by hand, once)

`GET /api/debug/roon-playlist-edit?run=1` (without `run=1` it says what it would do and touches nothing). On the
owner's server, native mode on:

1. Makes a playlist named "Rouen edit trial" and the time (`CreatePlaylist`, proven), waits for your server to list it
   (as the routes do before adding), and puts two library albums in it (`InsertAlbums`, proven), so it has at least
   three tracks.
2. Reads its items in the order they come (`VirtualItemsQuery`, with its own page and dispose calls, as
   `playlist-items.js` reads a playlist to play it), naming each by its track's title; an item of another playlist is
   passed over.
3. `MoveItems`: the third item to **before** the first. Reads the items again, until the order asked shows (by the
   items' ids, or their titles should Roon make new items for a moved one) or five reads have passed.
4. `RemoveItems`: the (original) first item. Reads the items again until it is gone or five reads have passed.
5. Deletes the playlist (`Delete`, proven) whatever happened above, a call that threw included; if the delete can't be
   made (the connection being checked after a call went unanswered), the answer says so and names the playlist, for
   deleting in Roon.

It answers each step: what was sent, the server's answer (where one comes), and the order read back before and after,
with a verdict for each method (moved as asked / not moved; removed / not removed). Nothing else in the library is
touched. Methods added to the allowlist: `Playlists::MoveItems`, `Playlists::RemoveItems`.

## 4. The build (after the probe's run)

Designed from what the run shows; written here before its code (`CLAUDE.md`, spec authority).
