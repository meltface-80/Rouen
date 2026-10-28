"use strict";
// ---------------------------------------------------------------------------
// v1.9.70-t2 (lib/credits/wikitext.js, wikipedia.js, dev/design/album-credits.md
// §2.4, §7): the owner, "See if you can use Wikipedia for this as well as
// MusicBrainz", for both. An album article's Personnel read as credits (the
// line-up at the time of recording, tracks where the line names them by
// number), the album's article found only when its infobox agrees; a band
// article's members now (its current group, else its infobox), Wikipedia's
// first. The wikitext is written as English Wikipedia writes it; no network.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const wt = require("../../lib/credits/wikitext");
const { createWikipedia, enwikiTitle } = require("../../lib/credits/wikipedia");
const { merge, rank } = require("../../lib/credits/rules");

const nameKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const albumKey = (t, a) => (t ? nameKey(t) + "||" + nameKey(a) : null);

const ALBUM = `{{Short description|1987 studio album by Anthrax}}
{{Infobox album
| name       = Among the Living
| type       = studio
| artist     = [[Anthrax (American band)|Anthrax]]
| producer   = {{flatlist|
* [[Eddie Kramer]]
* Anthrax
}}
}}
'''''Among the Living''''' is the third studio album.<ref>{{cite web|url=x|title=y}}</ref>

==Track listing==
{{Track listing
| title1 = Among the Living
}}

==Personnel==
Credits adapted from the album's liner notes.<ref name="liner"/>

;Anthrax
* [[Joey Belladonna]] – [[lead vocals]]
* [[Dan Spitz]] – lead guitar, backing vocals
* [[Scott Ian]] – rhythm guitar, backing vocals, lyrics
* [[Charlie Benante]] – drums, guitar {{small|(track 9)}}<!-- the outro -->

'''Additional musicians'''
* [[Paul Crook]] – guitar solo on "I Am the Law"
* John Doe and {{ill|Jane Roe|de}} – handclaps (tracks 2–4, 7)
* Kid A{{snd}}keyboards on tracks 1 and 6

'''Production'''
* Eddie Kramer – production, engineering, mixing
* Howie Weinberg – mastering
* Recorded at Quadradial Studios, Miami
* Don Brautigam – cover art

== References ==
* [[Bogus Person]] – not this album's
`;

const BAND = `{{Infobox musical artist
| name = Anthrax
| background = group_or_band
| members = {{flatlist|
* [[Scott Ian]]
* [[Charlie Benante]]
* [[Joey Belladonna]]
}}
| past_members = {{hlist|[[Dan Spitz]]|[[Neil Turbin]]}}
}}
== Members ==
{{Main|List of Anthrax band members}}
'''Current'''
* [[Scott Ian]] – rhythm guitar, backing vocals {{small|(1981–present)}}
* [[Charlie Benante]] – drums, percussion {{small|(1983–present)}}
* [[Joey Belladonna]] – lead vocals {{small|(1984–1992, 2005–2007, 2010–present)}}
* [[Jonathan Donais]] {{small|(2013–present)}}

'''Former'''
* [[Dan Spitz]] – lead guitar {{small|(1983–1995, 2005–2007)}}
* [[Neil Turbin]] – lead vocals {{small|(1981–1984)}}
== Discography ==
`;

test("THE one for §2.4: an album's Personnel as credits — the parts, the tracks it names by number, a song's name kept off the whole album", () => {
  const got = wt.personnel(ALBUM).map((c) => `${c.track} ${c.name}: ${c.role}`);
  assert.deepEqual(got, [
    "0 Joey Belladonna: Lead vocals", "0 Dan Spitz: Lead guitar", "0 Dan Spitz: Backing vocals",
    "0 Scott Ian: Rhythm guitar", "0 Scott Ian: Backing vocals", "0 Scott Ian: Lyrics",
    "0 Charlie Benante: Drums", "9 Charlie Benante: Guitar",
    "-1 Paul Crook: Guitar solo",
    "2 John Doe: Handclaps", "3 John Doe: Handclaps", "4 John Doe: Handclaps", "7 John Doe: Handclaps",
    "2 Jane Roe: Handclaps", "3 Jane Roe: Handclaps", "4 Jane Roe: Handclaps", "7 Jane Roe: Handclaps",
    "1 Kid A: Keyboards", "6 Kid A: Keyboards",
    "0 Eddie Kramer: Production", "0 Eddie Kramer: Engineering", "0 Eddie Kramer: Mixing",
    "0 Howie Weinberg: Mastering", "0 Don Brautigam: Cover art"]);
  assert.ok(!got.some((l) => l.includes("Bogus")), "the next section's lines are not the Personnel's");
  assert.deepEqual(wt.albumInfo(ALBUM), { name: "Among the Living", artist: "Anthrax" });
});

test("merged: Wikipedia's part named by a song keeps the tracks another source gives; its whole-album parts and free words rank", () => {
  const rows = merge([
    { track: 3, name: "Paul Crook", mbid: null, role: "Guitar", source: "musicbrainz" },
    ...wt.personnel(ALBUM)], 10, nameKey);
  const crook = rows.find((r) => r.name === "Paul Crook");
  assert.deepEqual([crook.roles, crook.tracks], [["Guitar", "Guitar solo"], [3]], "not made the whole album by the song-named part");
  assert.deepEqual(rows.find((r) => r.name === "Eddie Kramer").tracks, []);
  assert.deepEqual([rank("Production"), rank("Engineering"), rank("Cover art"), rank("Lyrics"), rank("Recorder"), rank("Guitar")], [2, 2, 3, 1, 0, 0]);
  assert.deepEqual(rows.map((r) => r.name).slice(-3), ["Eddie Kramer", "Howie Weinberg", "Don Brautigam"], "who made it, then its sleeve, last");
});

test("THE one for §7: a band's members now — its current group with their parts, years dropped; not the former members", () => {
  assert.deepEqual(wt.membersNow(BAND), [
    { name: "Scott Ian", roles: ["Rhythm guitar", "Backing vocals"] }, { name: "Charlie Benante", roles: ["Drums", "Percussion"] },
    { name: "Joey Belladonna", roles: ["Lead vocals"] }, { name: "Jonathan Donais", roles: [] }]);
  assert.deepEqual(wt.bandInfo(BAND), { group: true, person: false, name: "Anthrax", members: ["Scott Ian", "Charlie Benante", "Joey Belladonna"] });
  const noGroups = BAND.replace("'''Current'''\n", "").replace("'''Former'''\n", "");
  assert.equal(wt.membersNow(noGroups), null, "no current group: the section names none (the infobox's are next)");
});

test("the wikitext read as it shows: links, templates, references, comments; a line with no dash is no credit", () => {
  assert.equal(wt.clean("[[A (band)|A]] {{nowrap|B C}}<ref name=x>{{cite|y}}</ref><!-- n --> '''D''' {{sfn|E|2001}}[[File:x.jpg|thumb|[[F]]]]").trim(), "A B C D");
  assert.equal(wt.clean("{{sortname|Jay|Ruston}}"), "Jay Ruston");
  assert.equal(wt.creditLine("Credits adapted from the liner notes."), null);
  assert.deepEqual(wt.creditLine("Bob Rock: production (all tracks)"), { names: ["Bob Rock"], parts: [{ role: "Production", tracks: null }] });
  assert.deepEqual(wt.creditLine("Jean-Luc Ponty - violin (tracks 1 to 3; except 2)").parts, [{ role: "Violin", tracks: "some" }]);
  assert.deepEqual(wt.tracksOf("tracks 5, 8–9 & 11"), [5, 8, 9, 11]);
  assert.deepEqual(wt.creditLine("Slash – guitar solo in the outro of \"Song\", bass").parts, [{ role: "Guitar solo", tracks: "some" }, { role: "Bass", tracks: null }],
    "a part named by its song: on some tracks, the song's name left off it");
});

/** A Wikipedia that answers from articles held here. */
function fakeWiki(pages, o = {}) {
  const asked = [];
  const json = async (url, headers) => {
    asked.push(url);
    assert.ok(headers && headers["User-Agent"], "asked with Rouen's User-Agent");
    if (o.down) throw new Error("HTTP 503");
    const q = new URL(url).searchParams;
    if (q.get("list") === "search") return { query: { search: (o.results || Object.keys(pages)).map((title) => ({ title })) } };
    const t = q.get("page");
    return pages[t] ? { parse: { title: t, wikitext: pages[t] } } : { error: { code: "missingtitle", info: "The page you specified doesn't exist." } };
  };
  return { wiki: createWikipedia({ json, userAgent: "Rouen-test" }), asked };
}

test("the album's article: only a result naming the album whose infobox agrees — never another of the act's (wiki-match's lesson)", async () => {
  const other = ALBUM.replace("name       = Among the Living", "name       = Spreading the Disease");
  const { wiki, asked } = fakeWiki({ "Spreading the Disease (Anthrax album)": other, "Among the Living (album)": ALBUM, "Among the Living": "{{Infobox album\n| name = Among the Living\n| artist = Someone Else\n}}" },
    { results: ["Spreading the Disease (Anthrax album)", "Among the Living", "Among the Living (album)"] });
  const got = await wiki.album("Among the Living", "Anthrax", albumKey);
  assert.equal(got.article, "Among the Living (album)");
  assert.equal(got.credits.length, 24);
  assert.ok(!asked.some((u) => u.includes("Spreading")), "a result not naming the album is not read");
  const none = await fakeWiki({ "Among the Living": "{{Infobox album\n| name = Among the Living\n| artist = Someone Else\n}}" }).wiki.album("Among the Living", "Anthrax", albumKey);
  assert.deepEqual([none.article, none.credits], [null, []]);
  await assert.rejects(fakeWiki({}, { down: true }).wiki.album("X", "Y", albumKey), /503/, "out of reach: thrown, for a failed source");
});

test("the band's article: its Wikidata link's title, else a search's group of that name; its infobox's names when no current group", async () => {
  assert.equal(enwikiTitle({ entities: { Q1: { sitelinks: { enwiki: { title: "Anthrax (American band)" } } } } }, "Q1"), "Anthrax (American band)");
  const linked = await fakeWiki({ "Anthrax (American band)": BAND }).wiki.band("Anthrax", "Anthrax (American band)", nameKey);
  assert.deepEqual([linked.from, linked.members.length], ["section", 4]);
  const person = "{{Infobox musical artist\n| name = Anthrax\n| background = solo_singer\n}}";
  const searched = fakeWiki({ "Anthrax (singer)": person, "Anthrax (American band)": BAND.replace(/== Members ==[\s\S]*?== Discography/, "== Discography") });
  const got = await searched.wiki.band("Anthrax", null, nameKey);
  assert.deepEqual([got.article, got.from, got.members.map((m) => m.name)], ["Anthrax (American band)", "infobox", ["Scott Ian", "Charlie Benante", "Joey Belladonna"]],
    "a person of that name passed over; the group's infobox names");
  assert.deepEqual((await fakeWiki({}).wiki.band("Nobody", null, nameKey)).members, null);
});

// ---- the review's (v1.9.70-t2) ----

test("a comment on the infobox's first line, in a field or after a heading is read past; {{Infobox band}} is a band's", () => {
  const a = "{{Infobox album <!-- See Wikipedia:WikiProject_Albums -->\n| name = Nevermind <!-- | not this -->\n| artist = [[Nirvana (band)|Nirvana]] <!-- {{ -->\n}}\n== Personnel ==<!-- per the liner notes -->\n* [[Kurt Cobain]] – vocals\n";
  assert.deepEqual(wt.albumInfo(a), { name: "Nevermind", artist: "Nirvana" });
  assert.deepEqual(wt.personnel(a).map((c) => c.name), ["Kurt Cobain"]);
  assert.equal(wt.bandInfo("{{Infobox band <!-- See WikiProject_Musicians -->\n| name = Nirvana\n| background = group_or_band\n}}").group, true);
});

test("Personnel lines as articles write them: part first, in a columns list, names with commas in their links, years, Oxford commas", () => {
  const line = (l) => wt.creditLine(wt.clean(l));
  assert.deepEqual(line("Producer: [[Rick Rubin]]"), { names: ["Rick Rubin"], parts: [{ role: "Producer", tracks: null }] });
  assert.deepEqual(line("Mastering – Howie Weinberg").names, ["Howie Weinberg"]);
  const crew = wt.personnel("==Personnel==\n{{columns-list|colwidth=30em|\n* [[Kurt Cobain]] – vocals, guitar\n* [[Krist Novoselic]] – bass\n}}\n");
  assert.deepEqual(crew.map((c) => c.name), ["Kurt Cobain", "Kurt Cobain", "Krist Novoselic"]);
  const parse = (l) => wt.creditLine(wt.clean(l));
  assert.deepEqual(wt.personnel("== Personnel ==\n* [[Earth, Wind & Fire]] – horns\n* [[Harry Connick, Jr.]] – piano\n").map((c) => c.name), ["Earth, Wind & Fire", "Harry Connick, Jr."]);
  assert.deepEqual(parse("John Doe – drums on all tracks except 3").parts, [{ role: "Drums", tracks: "some" }]);
  assert.deepEqual(parse("John Doe – organ on tracks 1, 3, and 5").parts, [{ role: "Organ", tracks: [1, 3, 5] }]);
  assert.deepEqual(parse("John Doe – organ (tracks: 1, 3)").parts, [{ role: "Organ", tracks: [1, 3] }]);
  assert.deepEqual(parse("John Doe – vocals (credited as \"Johnny\")").parts, [{ role: "Vocals", tracks: null }]);
  assert.deepEqual(parse("[[Jonathan Donais]] {{small|2013–present}}"), null, "no dash but the years': no credit line");
  assert.deepEqual(parse("Scott Ian – guitar {{small|1981–present}}").parts, [{ role: "Guitar", tracks: null }]);
  assert.deepEqual(parse("Paul McCartney – lead and backing vocals, rhythm, acoustic and lead guitars").parts.map((p) => p.role),
    ["Lead vocals", "Backing vocals", "Rhythm guitars", "Acoustic guitars", "Lead guitars"]);
  assert.deepEqual([rank("Sound design"), rank("Lyricon"), rank("Lyrics")], [2, 0, 1]);
});

test("members: touring players and a line of prose are no current group; years outside brackets leave the name alone", () => {
  const band = "== Members ==\nThe band's current line-up has been in place since 2010, with several changes before.\n;Current members\n* [[A B]] – vocals\n* [[Jonathan Donais]] {{small|2013–present}}\n;Current touring musicians\n* [[T M]] – keyboards\n;Former\n* [[C D]] – guitar (1985–1990)\n";
  assert.deepEqual(wt.membersNow(band), [{ name: "A B", roles: ["Vocals"] }, { name: "Jonathan Donais", roles: [] }]);
  const mixed = "== Members ==\nThe band's current line-up has been in place since 2010, after several changes.\n* [[A B]] – vocals (2010–present)\n* [[C D]] – guitar (1985–1990)\n";
  assert.equal(wt.membersNow(mixed), null, "a line of prose saying \"current\" heads no group: former members not made current");
});

test("two articles that both agree — a self-titled album, two bands of one name — are none, unless the track count tells them apart; an answer that can't be read fails", async () => {
  const fm = (year, n) => `{{Infobox album\n| name = Fleetwood Mac\n| artist = [[Fleetwood Mac]]\n| released = ${year}\n}}\n== Track listing ==\n{{Track listing\n` +
    Array.from({ length: n }, (_, i) => `| title${i + 1} = Song ${i + 1}\n`).join("") + "}}\n== Personnel ==\n" + (year === 1968 ? "* [[Peter Green (musician)|Peter Green]] – guitar\n" : "* [[Lindsey Buckingham]] – guitar\n");
  const pages = { "Fleetwood Mac (1968 album)": fm(1968, 12), "Fleetwood Mac (1975 album)": fm(1975, 11) };
  const results = ["Fleetwood Mac", "Fleetwood Mac (1968 album)", "Fleetwood Mac (1975 album)"];
  const told = await fakeWiki(pages, { results }).wiki.album("Fleetwood Mac", "Fleetwood Mac", albumKey, 11);
  assert.deepEqual([told.article, told.credits.map((c) => c.name)], ["Fleetwood Mac (1975 album)", ["Lindsey Buckingham"]]);
  const untold = await fakeWiki(pages, { results }).wiki.album("Fleetwood Mac", "Fleetwood Mac", albumKey, 0);
  assert.deepEqual([untold.article, untold.credits], [null, []]);
  assert.match(untold.why, /tell them apart/);
  const nirvana = "{{Infobox musical artist\n| name = Nirvana\n| background = group_or_band\n| members = [[A B]]\n}}";
  const two = await fakeWiki({ "Nirvana (band)": nirvana, "Nirvana (British band)": nirvana }).wiki.band("Nirvana", null, nameKey);
  assert.equal(two.members, null, "two bands of the name: neither");
  const linked = await fakeWiki({ "Nirvana (band)": "{{Infobox musical artist\n| name = Nirvana\n| members = [[Dave Grohl]]\n}}" }).wiki.band("Nirvana", "Nirvana (band)", nameKey);
  assert.deepEqual(linked.members, [{ name: "Dave Grohl", roles: [] }], "the Wikidata item's article: taken without a background saying group");
  const odd = createWikipedia({ json: async () => ({ batchcomplete: true }), userAgent: "t" });
  await assert.rejects(odd.album("X", "Y", albumKey), /can't be read/);
  assert.equal(enwikiTitle({ entities: { Q9: { sitelinks: { enwiki: { title: "Merged" } } } } }, "Q1"), "Merged", "an item since merged: the one entity there");
});
