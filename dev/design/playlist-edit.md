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

### 3.1 The run (the owner's server, 2026-11-10, 2.0.4-t12)

A 26-track trial playlist made from two albums:
- `MoveItems(the third, Before, the first)` answered Success. The order read back was the one asked, by the same item
  ids (`sameIds`), on the first read.
- `RemoveItems(the first as made)` took the count from 26 to 25 and the item out, on the first read.
- The trial playlist was deleted.

Two things learnt for the build:
- **Item ids last.** An item's object id outlived the release of the page it came on and its query's dispose: the
  calls named items read, released and disposed before them.
- **Arrival order is the playlist's order.** The items came in the playlist's order. Their `Index` matched it, but the
  first item's was not sent: `Index` is not to be trusted, and arrival order is used.

Both methods are proven, for this use.

## 4. The build (2.0.4-t13)

### 4.1 What the page does

As §1, with:
- **Where it appears.** Edit playlist is offered where Rename and Delete are (`playlists-native.js`'s `decorate`: one
  Roon playlist of that name, native mode on), and only when the playlist isn't read-only.
- **Turning it on.** Edit mode sets the Sort to Playlist order and closes the find. The Sort the page had is put back
  on Done. The A–Z slider hides itself in Playlist order. The rows are sorted directly, not through the Sort's button,
  so Playlist order is never kept as this device's choice: a page left by ‹ without Done keeps the Sort you chose (the
  review).
- **The top block.** It shows Done alone: the buttons, the Sort and the find are hidden while editing.
- **The row controls.** A row's − and ≡ are 44px targets. A tap anywhere else on the row does nothing.
- **Dragging.** A drag starts on the ≡ only, with a finger or a mouse. The row follows the pointer and the others make
  room. Near the top block or the screen's foot the page scrolls. On release, a row put somewhere new is sent as one
  move.
- **One change at a time.** While a change is on its way, or a row is held by its ≡, the page refuses another and says
  so ("One change at a time"); − and ≡ are dimmed. A drag let go while a change is on its way goes back. A drag ends
  wherever the pointer is let go (its moves and release are taken on the window).
- **When a change is believed.** Only when the server's read-back shows it. Until then:
  - a moved row stands where it was dropped, and goes back if the change isn't believed;
  - a removed row stays until the change is believed, then goes.

  A change not believed says why, as a toast: Roon's refusal, "Roon didn't take that change", or "This playlist has
  changed since it was opened; reopen it" (§4.2's stale case).
- **Keeping the page whole.** After each change believed, the page's own list of the playlist's tracks (the array the
  rows were built from, which Play now, Queue and a row's tap read) is changed the same way. Each track's place
  (`index`), each row's place (`__order`, `data-pos`, `data-index`) and the count are numbered again. The count is the
  line's own number less one, so a long playlist's line, which counts tracks the page didn't read, stays right. Play
  and the Sort then act on the playlist as it now is, without reading it again.
- **Late artist names.** Each row's own artist, asked of your server when the page opened, is put on the rows by their
  places. An answer that comes after a change has been kept is not applied: its places are no longer the rows'. Those
  rows keep the official API's line.
- **The question's words.** "Remove" and "Cancel" are given to the app's dialog for this question (`menus.js`'s
  `confirmDialog` takes them). Every other question keeps No and Yes.

### 4.2 The server: `lib/roon-direct/playlist-edit.js`

Rows are named to the server by their place in the playlist and their title. The page's rows come from the official
API, which knows no item ids, and an item's object id belongs to one connection anyway. Each change:

1. **In one turn.** The playlist is found by its id, editable (`playlists.js`'s `editable`: native mode on, the
   connection sure, room for objects, the playlist the profile's and not read-only, its name its own). The page holding
   each place named is read (`playlist-items.js`'s `readItemsPage`, which now also gives each item's object id, beside the items it sends the page). It
   reads only with 70,000 objects of room left, as `playlist-artists.js` does.
2. **The stale check.** Each of these answers stale (409), and nothing is sent:
   - a place whose item's title isn't the title named (compared as `playlist-artists.js`'s `norm` does);
   - a place past the playlist's end;
   - a playlist whose length isn't the page's own count. The page sends its count when it has every row (no "Showing
     the first … of …" note). The review found this was needed: an item Roon's own list holds and the official API's
     rows leave out shifts every place after it, and a title shared by neighbours could hide the shift.

   Either the playlist changed since the page was read, or its rows don't line up with Roon's.
3. **The change, in the same turn:**
   - a move is `MoveItems([the item at from], After the item at to)` when going down, and `Before` it when going up;
   - a remove is `RemoveItems([the item at at])`, which sends no answer.
4. **The read-back.** It is made in turns of its own, up to five reads about a second apart, on the same connection;
   a connection changed in the meantime is said, not guessed at. A read that fails (a query not answered in time) is
   one of the five, not the end (the review). A move whose two places are on one page reads that page once.
   - A move is believed when the item at `to` is the moved item, by object id. The run showed ids kept: a title could
     belong to two tracks.
   - A remove is believed when the count is one less and the removed item's id is no longer on its page.

   A change read back and not there answers "Roon didn't take that change" (502). One never read back, because all
   five reads failed, says so and asks for the playlist to be reopened (502): the change may have been made.
5. **One change at a time.** Changes take their turns one after another, across the server.

Routes (`lib/routes/roon-playlist-edit.js`), as `/api/roon-playlists/*`:
- `POST /api/roon-playlists/move {id, from, from_title, to, to_title, count?}`
- `POST /api/roon-playlists/remove {id, at, title, count?}`

Each answers `{ ok: true }`, or `{ ok: false, error, stale? }` with 400 (bad input), 409 (stale), 503 (not sent:
native mode off, not connected, no room) or 502 (refused, or not seen).

The probe stays, for running again by hand should a Roon update be suspected (§3).
