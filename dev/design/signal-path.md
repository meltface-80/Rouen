# The signal path on Now playing

Read before working on the signal path: what Roon sends for it (`native-remote.md` §16.7, the reads that found it),
how Rouen reads it (`lib/roon-direct/signal-path.js`) and how Now playing shows it (`public/signal-path.js`).

## 1. The request

The owner, 2026-11-09: "I also want Roons signal path to be visible from the now playing screen in a similar means to
roon". Asked how, 2026-11-10, the owner chose:
- **A dot and a card, as Roon.** A coloured dot for the path's quality beside the format on Now playing; a tap opens a
  card listing each step. It follows the playing track and the zone's DSP as they change.
- **Now playing only.** The mini player bar is unchanged.

## 2. What Roon sends (the owner's reads of 2026-11-10, t13 and t14's probes)

A Zone holds a `SignalPath` object (its Endpoint names the same one): `Quality`, `ProcessingSpeed` (Roon's "×"), at
times `IsClipping`, and `Elements`, a list object of `SignalPathElement` objects in playing order. Each element is its
`Quality`, a `UniqueId` and exactly one part, an object named by the member it hangs on (`Source`, `Raat`, `Output`,
`SampleRateConversion`, …: 45 kinds in the catalogue, `SignalPathElement`'s members).

`Quality` is the catalogue's `SignalPathQuality`: Inactive 0, LowQuality 1, HighQuality 2, Lossless 3, Enhanced 4,
None 5. The path's own is shown as Roon sends it, never worked out from its steps here.

What the reads found (members a part leaves at their default are not sent, so absent):

| Read | Zone | Steps | Path |
|---|---|---|---|
| plain | "poly" (Chord Poly, RAAT, to a Mojo2), FLAC 44.1/16 | Source, Raat, Output, each 3 | 3, 1345.4× |
| DSP on | "poly", the hidden 96/24 Dark Side | Source 3, UpgradeBitDepth 3, VolumeNormalization 4, HeadroomGain 4, SampleRateConversion 4, Crossfeed 4, ParametricEQ 4, Truncate 3, Raat 3, Output 3 | 4, 23.7× |
| DSP on, t14 (whole) | "TV Speaker" (Sonos Beam), FLAC 44.1/16 | Source {Format "Flac", SampleRate 44100, BitsPerSample 16, Channels 2, BitRate 616, ContentSource 1} · UpgradeBitDepth {16 → 64} · VolumeNormalization {GainDb −0.79} · HeadroomGain {GainDb −3} · Crossfeed {Description "Bauer stereo-to-binaural"} · ParametricEQ {FilterCount 5} · Truncate {64 → 24} · Output {OutputType 24, Model "BEAM"} | 4, 294.5× |

The parts' members are the catalogue's (`Sooloos.Broker.Api.*SignalPathElement`); those the reads have not shown yet
(a RAAT step's `Device` whole, sample-rate conversion's rates, the rest) are read by the same names and said as they
come: a member missing is left out, never guessed.

## 3. The screen

### 3.1 The dot

Under the album name on Now playing, where a phone's zone shows its format (`#np-format`), a button: a dot in the
path's colour and, beside it, the source as Roon says it: "FLAC 44.1kHz 16-bit" (format, rate, depth; a lossy
source its bit rate, "AAC 256kbps"; DSD its rate, "DSD 2.8MHz"). Its label for a screen reader: "Signal path:
Lossless. FLAC 44.1kHz 16-bit".

The colours, by the path's quality: **Enhanced** violet (#a77bf3), **Lossless** blue-violet (#6c8cff), **High
quality** green (#3fb37f), **Low quality** amber (#e0a43a); Inactive and None, no dot (the button hides). The dot
alone carries no meaning a colour-blind eye needs: the card names the quality in words.

### 3.2 The card

A tap opens a card over Now playing (a sheet from the bottom on a phone, centred above 720px), closed by its ×, a tap
outside or Escape, and gone when Now playing closes.

- Its head: **Signal path**, then the quality in words ("Enhanced") and "Processing speed 294.5×"; "Clipping" in
  amber when `IsClipping` is sent true.
- Then a row a step, in Roon's order, each with its own dot and a name, and under it what the step does:

| Part | Name | What it says (example) |
|---|---|---|
| Source | Source | FLAC 44.1kHz 16-bit · Stereo · Library (TIDAL, Qobuz… by `MediaSource`) |
| UpgradeBitDepth | Bit depth | 16 → 64-bit |
| Truncate | Truncation | 64 → 24-bit |
| MQBRestore | MQB restore | 16 → 24-bit |
| VolumeNormalization | Volume levelling | −0.8 dB |
| HeadroomGain | Headroom | −3.0 dB |
| DigitalVolume | Volume | −12.0 dB |
| AnalogVolume | Volume (analogue) | −12.0 dB |
| SampleRateConversion | Sample rate conversion | 96 → 384kHz |
| DsdSampleRateConversion | DSD rate conversion | 2.8 → 5.6MHz |
| PcmToDsd / DsdToPcm | PCM to DSD / DSD to PCM | 44.1kHz → 5.6MHz |
| Crossfeed | Crossfeed | Bauer stereo-to-binaural |
| ParametricEQ | Parametric EQ | 5 filters · its preset's name |
| ProceduralEQ | Procedural EQ | 3 filters |
| EQ / MultiBandEQ | EQ | its preset or gain |
| Convolution | Convolution | 65536 taps |
| CrossFade | Crossfade | 5000 ms |
| Delay | Delay | 12 ms |
| Balance | Balance | its own words (`StringValue`) |
| ChannelMapping / ChannelMixing | Channel mapping / mixing | its own words (`Description`) |
| Dither | Dither | to 24-bit |
| HQPlayer | HQPlayer | filter · shaper · rate |
| Raat | RAAT | the device ("Chord Poly → Chord Electronics Ltd Mojo2") |
| Output | Output | the model, then the kind by `OutputSignalPathElementType` ("BEAM · Sonos", "Poly · RAAT") |
| any other | its member's name, spaced ("Speaker Setup") | nothing more |

A value a step leaves out drops from its line; a step with nothing to say shows its name alone.

### 3.3 When

Read when Now playing opens, when its track changes, and every 5 seconds while it shows (a read of what the connection
holds: nothing is asked of the server). Shown only when native mode is on, connected, and the selected zone is one of
Roon's with a path; otherwise the button hides. A phone's zone keeps its own format badge.

## 4. How

- `lib/roon-direct/signal-path.js` (new): `pathOf(graph, zone)`, the path in plain terms (quality, speed, clipping, the
  steps each with its kind, quality, name and line), and `createSignalPath({ link, on }).read(zoneId)`, the zone found
  as zone-settings.js finds it. Read only.
- `GET /api/roon/signal-path?zone_id=` (`lib/roon-direct/route.js`, beside the zone's settings).
- `public/signal-path.js` and `.css` (new), loaded by `album-view.js`: the button after `#np-format`, the card, the
  reads. The zone is `window.__selectedZoneId()`.
- No change to `app.js` or `index.js`.

## 5. Not in this build

- The dot on the mini bar (the owner: Now playing only).
- Each output of a grouped zone's own path (Roon's card shows one per output); the zone's own path is what is read.
- The step's own help text Roon shows on a tap.
