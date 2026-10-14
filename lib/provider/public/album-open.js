// @ts-check
"use strict";
/*
 * album-open.js — an album's page and its actions (play, next, queue, a
 * track's own) through Roon's official extension API: the public provider
 * (dev/design/native-remote.md §3.1). Moved out of index.js unchanged in
 * v1.9.21; what it reads of Rouen's — the browse calls, the album's session
 * (loadAlbumSession), the track filters, the errors — is passed in.
 */

/**
 * @param {{ withBrowseSession: Function, loadAlbumSession: Function, discsOf: Function,
 *           isTrackItem: Function, stripTrackNumber: (title: string) => string,
 *           noActionError: Function, libraryChangingAdvice: (sure: boolean) => string,
 *           roonBrowseError: Function, browse: Function, load: Function, normalize: (s: string) => string }} deps
 */
function createAlbumOpen(deps) {
  async function openAlbumByOffset(offset, zoneOrOutputId, invokeKind, filter, expect) {
    const { withBrowseSession, loadAlbumSession, discsOf, isTrackItem, stripTrackNumber, noActionError, libraryChangingAdvice, browse } = deps;
    return withBrowseSession(async (sessionKey) => {
      const { hierarchy, albumItem, items, playMenu, offset: effectiveOffset,
              libraryMoved, shortRead, declared } =
        await loadAlbumSession(sessionKey, offset, filter, expect, zoneOrOutputId);

      const albumInfo = {
        title:     albumItem.title || "",
        subtitle:  albumItem.subtitle || "",
        image_key: albumItem.image_key || null
      };

      // Which disc each track is on (v1.9.4, lib/discs.js): read from the rows
      // the track filter drops and from Roon's numbering, before it is stripped.
      // Said only for a set — an ordinary album's tracks carry no disc at all.
      const disc = discsOf(items, t => isTrackItem(t, playMenu));
      const tracks = items
        .filter(t => isTrackItem(t, playMenu))
        .map((t, i) => {
          const tr = {
            title:    stripTrackNumber(t.title),
            subtitle: t.subtitle || ""
          };
          if (disc.count > 1) tr.disc = disc.of[i];
          return tr;
        });

      let actions = [];
      if (playMenu) {
        actions = await drillActionMenu(hierarchy, sessionKey, playMenu.item_key);
      }

      // 7) Optionally invoke one
      let invoked = null;
      if (invokeKind) {
        const action = matchAction(actions, invokeKind);
        if (!action) {
          // Two different facts, and they used to share one string — with an
          // empty "Available:" list left dangling when Roon offered no menu at
          // all. Say which it is, and say what we can prove about why.
          const err = (actions.length || !libraryMoved)
            ? noActionError(invokeKind, actions, "this album")
            // The one case where more can honestly be said: Roon offered nothing
            // AND its live album count no longer matches the snapshot, so the
            // list this offset came from is out of date. Past tense — a mismatch
            // proves the library CHANGED, not that an import is running now.
            : new Error("Roon offered no playback options for this album." +
                        libraryChangingAdvice(true));
          // A library that has moved is a transient condition — the library
          // watch was asked to look the moment the open saw it — so it gets the
          // same 409 "try again" contract a stale offset does rather than a 500.
          if (libraryMoved) err.stale = true;
          throw err;
        }
        if (!zoneOrOutputId) throw new Error("zone_or_output_id required to invoke an action");
        await browse({
          hierarchy,
          item_key:  action.item_key,
          zone_or_output_id: zoneOrOutputId,
          multi_session_key: sessionKey
        });
        invoked = action.title;
      }

      return { album: albumInfo, tracks, actions, invoked, offset: effectiveOffset,
               // What to call each disc of a set, or null for an ordinary album.
               discs: disc.count > 1 ? disc.labels : null,
               // Told to the client so the album view can explain a thin answer
               // instead of silently hiding the track list.
               library_moved: !!libraryMoved,
               partial: !!shortRead,
               declared_tracks: Number.isFinite(declared) ? declared : null };
    });
  }

  function classifyAction(title) {
    const t = (title || "").toLowerCase();
    if (/play\s*now/.test(t))            return "play_now";
    if (/add\s*next|play\s*next/.test(t))return "play_next";
    if (/queue/.test(t))                 return "queue";
    if (/shuffle/.test(t))               return "shuffle";
    if (/radio/.test(t))                 return "radio";
    return "other";
  }
  function matchAction(actions, kind) {
    return actions.find(a => a.kind === kind)
        || (kind === "play_now" ? actions.find(a => /^play/i.test(a.title)) : null);
  }

  // Drill into an action_list item (the album's Play menu, or a single track)
  // and return its classified actions. The action check guards against a
  // non-list response — without it, the follow-up load would re-read the
  // CURRENT level and the caller could "invoke" a misclassified item and
  // report false success.
  async function drillActionMenu(hierarchy, sessionKey, itemKey) {
    const { browse, load, roonBrowseError } = deps;
    const d = await browse({ hierarchy, item_key: itemKey, multi_session_key: sessionKey });
    if (d.action !== "list") {
      throw roonBrowseError(d, "this menu");
    }
    const acts = await load({ hierarchy, multi_session_key: sessionKey });
    return (acts.items || []).map(a => ({
      item_key: a.item_key,
      title:    a.title || "",
      hint:     a.hint  || "",
      kind:     classifyAction(a.title)
    }));
  }

  // Play or queue ONE track of an album. `trackIndex` is a position in the
  // same filtered track list /api/album returns (isTrackItem keeps the two
  // aligned), and the tap's title is verified against the re-resolved list —
  // if the library changed since the modal opened, the track is re-matched by
  // title rather than firing whatever now sits at that index; if the title is
  // gone entirely the caller gets a stale error (route maps it to 409).
  // `expect` is the ALBUM's identity ({title, subtitle}). It used to be omitted,
  // which meant albumIdentityMatches() short-circuited to true and the entire
  // stale-offset ladder below loadAlbumSession — relocate in-memory, then live
  // search — was unreachable for a per-track play. That was survivable while the
  // only caller was an album modal opened seconds earlier; it stops being
  // survivable the moment a track reference is stored and replayed later.
  async function invokeTrackAction(offset, trackIndex, trackTitle, zoneOrOutputId, kind, filter, expect) {
    const { withBrowseSession, loadAlbumSession, isTrackItem, stripTrackNumber, normalize, noActionError, browse } = deps;
    return withBrowseSession(async (sessionKey) => {
      const { hierarchy, items, playMenu } =
        await loadAlbumSession(sessionKey, offset, filter, expect, zoneOrOutputId);
      const trackItems = items.filter(t => isTrackItem(t, playMenu));

      const wanted = normalize(trackTitle || "");
      let item = trackItems[trackIndex];
      if (!item || (wanted && normalize(stripTrackNumber(item.title)) !== wanted)) {
        item = wanted
          ? trackItems.find(t => normalize(stripTrackNumber(t.title)) === wanted)
          : null;
      }
      if (!item) {
        const err = /** @type {Error & { stale?: boolean }} */ (new Error("Track list changed — close and reopen the album"));
        err.stale = true;
        throw err;
      }

      // Tapping a track opens its own action submenu (Play Now / Add Next /
      // Queue / Start Radio…) — same drill as the album's Play menu.
      const actions = await drillActionMenu(hierarchy, sessionKey, item.item_key);

      const action = matchAction(actions, kind);
      if (!action) {
        throw noActionError(kind, actions, "this track");
      }
      await browse({
        hierarchy,
        item_key:  action.item_key,
        zone_or_output_id: zoneOrOutputId,
        multi_session_key: sessionKey
      });
      return { invoked: action.title, track: stripTrackNumber(item.title) };
    });
  }

  return { openAlbumByOffset, matchAction, drillActionMenu, invokeTrackAction };
}

module.exports = { createAlbumOpen };
