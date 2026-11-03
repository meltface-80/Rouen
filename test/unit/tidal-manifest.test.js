"use strict";
// ---------------------------------------------------------------------------
// TIDAL hands back a base64 manifest, not a URL.
//
// Only the plain "BTS" kind carries audio this can read. The higher tiers come
// back as MPEG-DASH in a protected container, and refusing those is the correct
// answer rather than a gap — the track keeps the plain progress bar, which is
// what every other decline in this path also produces.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const { streamUrlFrom, BTS_MIME } = require("../../lib/tidal-manifest");

function bts(obj) { return Buffer.from(JSON.stringify(obj), "utf8").toString("base64"); }

test("a BTS manifest yields its first url", () => {
  const r = streamUrlFrom({
    manifestMimeType: BTS_MIME,
    manifest: bts({ codecs: "flac", urls: ["https://audio.tidal.com/a.flac", "https://b"] }),
  });
  assert.equal(r.url, "https://audio.tidal.com/a.flac");
  assert.equal(r.codec, "flac");
});

test("the mime is matched on prefix — TIDAL appends parameters to it", () => {
  const r = streamUrlFrom({
    manifestMimeType: BTS_MIME + "; charset=utf-8",
    manifest: bts({ urls: ["https://x/a.m4a"] }),
  });
  assert.equal(r.url, "https://x/a.m4a", "a charset parameter made a good manifest unreadable");
});

test("a DASH manifest is refused, and says WHY", () => {
  // Not lumped in with "unreadable": an encrypted tier is a different situation
  // from a track that cannot be played, and the user deserves to know which.
  const r = streamUrlFrom({ manifestMimeType: "application/dash+xml", manifest: "PG1wZD4=" });
  assert.equal(r.url, null);
  assert.match(r.reason, /dash/i);
  assert.match(r.reason, /encrypted/i);
});

test("an unknown manifest type is refused rather than guessed at", () => {
  const r = streamUrlFrom({ manifestMimeType: "application/octet-stream", manifest: "AAAA" });
  assert.equal(r.url, null);
  assert.match(r.reason, /octet-stream/);
});

test("a manifest that is not base64 JSON is refused, not thrown on", () => {
  const r = streamUrlFrom({ manifestMimeType: BTS_MIME, manifest: "!!!not base64 json!!!" });
  assert.equal(r.url, null);
  assert.match(r.reason, /could not be read/);
});

test("a BTS manifest with no urls is refused", () => {
  assert.equal(streamUrlFrom({ manifestMimeType: BTS_MIME, manifest: bts({ urls: [] }) }).url, null);
  assert.equal(streamUrlFrom({ manifestMimeType: BTS_MIME, manifest: bts({}) }).url, null);
});

test("non-string entries in urls are skipped, not returned", () => {
  const r = streamUrlFrom({
    manifestMimeType: BTS_MIME,
    manifest: bts({ urls: [null, 42, "", "https://good/a.flac"] }),
  });
  assert.equal(r.url, "https://good/a.flac");
});

test("no manifest, no response, and junk all decline without throwing", () => {
  for (const bad of [null, undefined, {}, { manifestMimeType: BTS_MIME }, "string", 7]) {
    const r = streamUrlFrom(bad);
    assert.equal(r.url, null);
    assert.ok(r.reason && r.reason.length > 0, "every decline must carry a reason");
  }
});

test("a missing mime with a readable BTS body is accepted", () => {
  // TIDAL has been observed omitting the type on some responses; the body is
  // still the thing that decides, and it parses or it does not.
  const r = streamUrlFrom({ manifest: bts({ urls: ["https://x/a.flac"] }) });
  assert.equal(r.url, "https://x/a.flac");
});

// ---------------------------------------------------------------------------
// manifestFrom (This phone's TIDAL, dev/design/android-app.md §4.22): where a
// track's audio is, for Rouen to fetch and serve to the phone — one address, or
// MPEG-DASH's pieces. The line stays where it was drawn: protected audio is
// refused, never read; plain DASH (TIDAL's lossless and hi-res FLAC) is read.
// ---------------------------------------------------------------------------
const { manifestFrom, parseMpd, MAX_PIECES } = require("../../lib/tidal-manifest");

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
/** A manifest shaped as TIDAL's: one FLAC Representation, a SegmentTemplate with a timeline. */
function mpd({ protect = false, timeline = '<S d="786432" r="2"/><S d="123456"/>', start = "1", media = "https://sp.audio.tidal.com/m/$Number$.mp4?token=a&amp;b=c" } = {}) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT3M12.5S">
 <Period id="0">
  <AdaptationSet id="0" contentType="audio" mimeType="audio/mp4" segmentAlignment="true">${protect ? '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>' : ""}
   <Representation id="FLAC,192000,24" codecs="flac" bandwidth="4600000" audioSamplingRate="192000">
    <SegmentTemplate timescale="192000" initialization="https://sp.audio.tidal.com/m/0.mp4?token=a&amp;b=c" media="${media}" startNumber="${start}">
     <SegmentTimeline>${timeline}</SegmentTimeline>
    </SegmentTemplate>
   </Representation>
  </AdaptationSet>
 </Period>
</MPD>`;
}
const dash = (xml) => ({ manifestMimeType: "application/dash+xml", manifest: b64(xml) });

test("THE one for DASH: plain FLAC in DASH is read — the initialisation, then every segment the timeline counts, in order", () => {
  const r = manifestFrom(dash(mpd()));
  assert.equal(r.pieces.length, 1 + 4, "<S r=\"2\"/> is three segments, the next <S/> one more");
  assert.equal(r.pieces[0], "https://sp.audio.tidal.com/m/0.mp4?token=a&b=c");
  assert.deepEqual(r.pieces.slice(1), [1, 2, 3, 4].map((n) => "https://sp.audio.tidal.com/m/" + n + ".mp4?token=a&b=c"));
  assert.equal(r.url, r.pieces[0]);
  assert.equal(r.mime, "audio/mp4");
  assert.equal(r.rate, 192000);
  assert.equal(r.codec, "flac");
});

test("THE one for the line: protected DASH and encrypted BTS are refused, saying so — nothing is ever decrypted", () => {
  const p = manifestFrom(dash(mpd({ protect: true })));
  assert.equal(p.url, null);
  assert.match(p.reason, /protected/);
  const e = manifestFrom({ manifestMimeType: BTS_MIME, manifest: bts({ urls: ["https://x/a.flac"], encryptionType: "OLD_AES", keyId: "k" }) });
  assert.equal(e.url, null);
  assert.match(e.reason, /encrypted/);
  const ok = manifestFrom({ manifestMimeType: BTS_MIME, manifest: bts({ urls: ["https://x/a.flac"], encryptionType: "NONE", mimeType: "audio/flac", codecs: "flac" }) });
  assert.deepEqual(ok, { url: "https://x/a.flac", pieces: null, mime: "audio/flac", rate: 0, codec: "flac" });
});

test("segment numbers: startNumber, zero-padding and the Representation's id are filled in as the template says", () => {
  const m = parseMpd(mpd({ start: "7", timeline: '<S d="1" r="1"/>', media: "https://h/$RepresentationID$/seg-$Number%05d$.mp4" }));
  assert.deepEqual(m.pieces.slice(1), ["https://h/FLAC,192000,24/seg-00007.mp4", "https://h/FLAC,192000,24/seg-00008.mp4"]);
});

test("a manifest that is not one track's is refused, not followed: no template, a bad repeat, or more segments than a track has", () => {
  assert.equal(manifestFrom(dash("<MPD></MPD>")).url, null);
  assert.equal(parseMpd(mpd({ timeline: '<S d="1" r="-3"/>' })), null);
  assert.equal(parseMpd(mpd({ timeline: `<S d="1" r="${MAX_PIECES}"/>` })), null, "a huge repeat would build a list of millions of addresses");
  assert.match(manifestFrom({ manifestMimeType: "video/mp4", manifest: b64("x") }).reason, /video\/mp4/);
});

test("streamUrlFrom, the waveform's, is unchanged: it still refuses DASH", () => {
  assert.equal(streamUrlFrom(dash(mpd())).url, null);
});

test("the line holds against any sign of protection: a prefixed ContentProtection, or CENC's markers alone", () => {
  for (const mark of ['<mpd:ContentProtection schemeIdUri="x"/>', '<AdaptationSet cenc:default_KID="abc">', "<pssh>AAAA</pssh>"]) {
    const xml = mpd().replace("<SegmentTemplate", mark + "<SegmentTemplate");
    assert.equal(manifestFrom(dash(xml)).url, null, mark);
  }
});

test("only absolute https addresses are followed, and no padding wider than a track's", () => {
  assert.equal(parseMpd(mpd({ media: "seg-$Number$.mp4" })), null, "a relative address");
  assert.equal(parseMpd(mpd({ media: "http://10.0.0.1/$Number$.mp4" })), null, "plain http, an inside host");
  assert.equal(parseMpd(mpd({ media: "https://h/$Number%0999999999d$.mp4" })), null, "a gigabyte of zeros per piece");
  assert.equal(parseMpd(mpd({ media: "https://h/$Time$.mp4" })), null, "time-addressed segments, which this doesn't fill");
  assert.match(manifestFrom({ manifestMimeType: BTS_MIME, manifest: bts({ urls: ["file:///etc/passwd"] }) }).reason, /won't follow/);
});

test("no timeline: as many segments as the presentation's length takes, not one", () => {
  const xml = `<MPD mediaPresentationDuration="PT1M2.5S"><Period><AdaptationSet mimeType="audio/mp4"><Representation id="r">
    <SegmentTemplate timescale="44100" duration="176400" initialization="https://t/0.mp4" media="https://t/$Number$.mp4" startNumber="1"/>
    </Representation></AdaptationSet></Period></MPD>`;
  const m = parseMpd(xml);
  assert.equal(m.pieces.length, 1 + 16, "62.5 s at 4 s a segment is 16 segments");
  assert.equal(m.pieces[16], "https://t/16.mp4");
  assert.equal(parseMpd(xml.replace(' mediaPresentationDuration="PT1M2.5S"', "")), null, "no length to count by: refused, not one segment");
});
