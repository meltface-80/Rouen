// @ts-check
"use strict";
/*
 * tidal-manifest.js — getting a playable URL out of TIDAL's playback response.
 *
 * Unlike Qobuz, TIDAL does not hand back a URL. It returns a base64-encoded
 * manifest whose type decides whether there is anything usable inside:
 *
 *   application/vnd.tidal.bt   "BTS" — plain JSON carrying direct audio URLs.
 *                              This is the one this reads.
 *   application/dash+xml       MPEG-DASH, used for the higher tiers. It can be
 *                              ENCRYPTED, and decrypting protected audio is a
 *                              line this project does not cross. Refused.
 *
 * So the rule is: BTS or nothing, and "nothing" means the track keeps the plain
 * progress bar — the same answer every other decline in the waveform path gives.
 * Refusing an unreadable manifest is not a gap to be closed later; it is the
 * correct outcome.
 *
 * Pure: base64 and JSON, no network, no account, no subscription.
 *
 * manifestFrom (v1.9.72, dev/design/android-app.md §4.22, This phone's TIDAL): the same line, drawn where the
 * protection actually is. For This phone Rouen fetches a track's audio itself and serves it to the app (Mandarin's
 * ServiceStreams), and TIDAL's lossless and hi-res tiers come as MPEG-DASH: an initialisation piece and numbered
 * segments, plain FLAC in MP4 unless the manifest says it is protected. So DASH is read when, and only when, it carries
 * no <ContentProtection>; a protected one is refused as before, and so is a BTS manifest whose encryptionType is
 * anything but NONE (Mandarin's rule; streamUrlFrom, for the waveform, is left as it was). Nothing is ever decrypted.
 */

// The only manifest type this reads. Matched on prefix because TIDAL appends
// parameters to it ("application/vnd.tidal.bt; charset=utf-8" and similar).
const BTS_MIME = "application/vnd.tidal.bt";

/**
 * The first playable URL in a playbackinfo response, or null with a reason.
 *
 * @param {object} j  the parsed playbackinfopostpaywall body
 * @returns {{url:string|null, reason:string, codec?:string}}
 */
function streamUrlFrom(j) {
  if (!j || typeof j !== "object") return { url: null, reason: "no playback response" };

  const mime = String(j.manifestMimeType || "");
  if (!j.manifest) return { url: null, reason: "TIDAL returned no manifest for this track" };

  if (mime && mime.indexOf(BTS_MIME) !== 0) {
    // Named rather than lumped in with "unreadable": a DASH manifest means the
    // account is entitled to a tier delivered in a protected container, which is
    // a different situation from a track that cannot be played at all, and the
    // user deserves to know which.
    return { url: null,
             reason: "TIDAL returned a " + mime + " manifest rather than plain audio" +
                     (mime.indexOf("dash") >= 0
                        ? " — that tier is delivered encrypted, so there is no waveform for it"
                        : "") };
  }

  let doc;
  try {
    doc = JSON.parse(Buffer.from(String(j.manifest), "base64").toString("utf8"));
  } catch (e) {
    return { url: null, reason: "TIDAL's manifest could not be read" };
  }

  const urls = (doc && Array.isArray(doc.urls)) ? doc.urls.filter((u) => typeof u === "string" && u) : [];
  if (!urls.length) return { url: null, reason: "TIDAL's manifest carried no audio url" };

  return { url: urls[0], reason: "ok", codec: (doc && doc.codecs) ? String(doc.codecs) : "" };
}

/** A DASH manifest with more segments than this is not a track's (a 30-minute track at 4 s each is 450). */
const MAX_PIECES = 20000;
/** A segment number padded wider than this is not a track's ($Number%05d$ is TIDAL's widest). */
const MAX_PAD = 12;
/** Only absolute https addresses are followed: never a relative one, another scheme, or a host on the plain web. */
const isHttps = (/** @type {string} */ u) => /^https:\/\/[^/\s]+\//i.test(u);
/** Any sign of protection in a DASH manifest: the element (with or without a namespace prefix), or CENC's markers. */
const PROTECTED = /<(?:[\w-]+:)?ContentProtection\b|cenc:default_KID|\bpssh\b/i;

/** An ISO 8601 duration (PT1H2M3.5S) in seconds, or NaN. @param {string | null} d */
function seconds(d) {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(d || ""));
  if (!m || !(m[1] || m[2] || m[3])) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/** An XML attribute's text, its entities read; null when the tag hasn't it. @param {string} tag @param {string} name */
function attr(tag, name) {
  const m = new RegExp("\\b" + name + "=\"([^\"]*)\"").exec(tag);
  if (!m) return null;
  return m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/**
 * TIDAL's MPEG-DASH manifest (an MPD) for one audio track, read as Mandarin's ParseMpd reads it: the initialisation
 * address, then each numbered segment's, from the SegmentTemplate and its SegmentTimeline (each <S> is one segment,
 * repeated r more times) — or, with no timeline, from the template's segment duration and the presentation's. Null when
 * it is not one this can read: no template, a time-addressed one ($Time$), an address that isn't absolute https, a
 * padding or a segment count no track has.
 * @param {string} xml
 * @returns {{ pieces: string[], mime: string, rate: number } | null}
 */
function parseMpd(xml) {
  const tpl = /<SegmentTemplate\b[^>]*>/.exec(xml);
  if (!tpl) return null;
  const init = attr(tpl[0], "initialization"), media = attr(tpl[0], "media");
  if (!init || !media || /\$Time\$/.test(media) || !isHttps(init) || !isHttps(media)) return null;
  for (const w of media.matchAll(/\$Number%0(\d+)d\$/g)) if (Number(w[1]) > MAX_PAD) return null;
  const startAttr = Number(attr(tpl[0], "startNumber"));
  const start = Number.isInteger(startAttr) && startAttr >= 0 ? startAttr : 1;
  let count = 0;
  for (const s of xml.matchAll(/<S\b([^>]*)\/?>/g)) {
    const r = Number(attr(s[0], "r") || 0);
    if (!Number.isInteger(r) || r < 0) return null;
    count += 1 + r;
    if (count > MAX_PIECES) return null;
  }
  if (count === 0) {
    // No timeline: as many segments as the presentation's length takes at the template's segment length.
    const each = Number(attr(tpl[0], "duration")) / (Number(attr(tpl[0], "timescale")) || 1);
    const mpd = /<MPD\b[^>]*>/.exec(xml);
    const total = seconds(mpd && attr(mpd[0], "mediaPresentationDuration"));
    if (!(each > 0) || !(total > 0)) return null;
    count = Math.ceil(total / each - 1e-9);
    if (count > MAX_PIECES) return null;
  }
  const rep = /<Representation\b[^>]*>/.exec(xml);
  const set = /<AdaptationSet\b[^>]*>/.exec(xml);
  const id = (rep && attr(rep[0], "id")) || "";
  const pieces = [init];
  for (let i = 0; i < count; i++) {
    const n = String(start + i);
    pieces.push(media.replace(/\$Number(%0(\d+)d)?\$/g, (_m, _f, width) => (width ? n.padStart(Number(width), "0") : n))
      .replace(/\$RepresentationID\$/g, id));
  }
  const mime = (rep && attr(rep[0], "mimeType")) || (set && attr(set[0], "mimeType")) || "audio/mp4";
  const rate = Number((rep && attr(rep[0], "audioSamplingRate")) || (set && attr(set[0], "audioSamplingRate")) || 0) || 0;
  return { pieces, mime, rate };
}

/**
 * Where a track's audio is, from a playbackinfo response, for Rouen to fetch and serve to This phone: one address
 * (BTS), or DASH's pieces in order (the initialisation first); or why not. Protected audio is refused, never read.
 * @param {any} j  the parsed playbackinfopostpaywall body
 * @returns {{ url: string, pieces: string[] | null, mime: string, rate: number, codec: string } | { url: null, reason: string }}
 */
function manifestFrom(j) {
  if (!j || typeof j !== "object") return { url: null, reason: "no playback response" };
  if (!j.manifest) return { url: null, reason: "TIDAL returned no manifest for this track" };
  const mime = String(j.manifestMimeType || "");
  const text = Buffer.from(String(j.manifest), "base64").toString("utf8");
  if (!mime || mime.indexOf(BTS_MIME) === 0) {
    let doc;
    try { doc = JSON.parse(text); } catch (e) { return { url: null, reason: "TIDAL's manifest could not be read" }; }
    const enc = doc && doc.encryptionType;
    if (enc && enc !== "NONE") return { url: null, reason: "TIDAL sent this track encrypted (" + String(enc) + "), which Rouen does not play" };
    const urls = (doc && Array.isArray(doc.urls)) ? doc.urls.filter((/** @type {any} */ u) => typeof u === "string" && u) : [];
    if (!urls.length) return { url: null, reason: "TIDAL's manifest carried no audio url" };
    if (!isHttps(urls[0])) return { url: null, reason: "TIDAL's manifest named an address Rouen won't follow" };
    return { url: urls[0], pieces: null, mime: String((doc && doc.mimeType) || "audio/flac"), rate: 0, codec: String((doc && doc.codecs) || "") };
  }
  if (mime.indexOf("dash+xml") >= 0) {
    if (PROTECTED.test(text)) return { url: null, reason: "TIDAL sent this track protected (DRM), which Rouen does not play" };
    const m = parseMpd(text);
    if (!m) return { url: null, reason: "TIDAL's DASH manifest could not be read" };
    const rep = /<Representation\b[^>]*>/.exec(text);
    return { url: m.pieces[0], pieces: m.pieces, mime: m.mime, rate: m.rate, codec: String((rep && attr(rep[0], "codecs")) || "") };
  }
  return { url: null, reason: "TIDAL returned a " + mime + " manifest, which isn't audio Rouen can play" };
}

module.exports = { streamUrlFrom, manifestFrom, parseMpd, BTS_MIME, MAX_PIECES };
