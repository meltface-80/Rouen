// @ts-check
/*
 * settings-sheet.js — the Settings sheet's markup, moved out of index.html unchanged (v1.9.72-t33): its list, Setup and
 * its pages up to Artwork & metadata. settings-panes.js adds the rest of its pages. index.html was 1449 lines, over the
 * 850 a file may have (CLAUDE.md, the owner, 2026-10-14), and Settings was its largest block: with the two moved it is
 * under. What the sheet does is still app.js's, and the other Settings scripts'.
 *
 * Loaded where the markup stood, before app.js and every script that finds Settings' controls when it starts: the
 * markup is inserted where this script's tag stands, as select-bars.js and album-view.js do.
 */
(function settingsSheet() {
  "use strict";
  const here = document.currentScript;
  if (!here) return;
  here.insertAdjacentHTML("beforebegin", `
  <!-- Settings fills the screen (v1.8.69): no backdrop to tap and no grip to
       drag. It closes from the list's own button below, and Escape. -->
  <div id="settings-overlay" class="settings-overlay hidden" role="dialog" aria-modal="true" aria-label="Settings">
    <div class="settings-sheet">

      <!-- Settings home: category list. Each row opens a pane below. -->
      <div class="settings-view" data-view="home">
        <div class="settings-head">
          <h2>Settings</h2>
          <!-- The way out of Settings (v1.8.69); a pane's Back returns here.
               The update button closes Settings by clicking this too. -->
          <button class="settings-app-close" type="button" data-settings-close aria-label="Close settings">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <!-- Settings, grouped like Mandarin's (v1.8.83, Mandarin v0.6.21): the
             things you connect and play through at the top level, and the
             app's own preferences under Setup, whose pages go Back to Setup. -->
        <nav class="settings-nav" aria-label="Settings categories">
          <button class="settings-nav-item" type="button" data-pane="streaming">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Services</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="playback">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Playback</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="display">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Wall Display</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="setup">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Setup</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="backup">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><line x1="10" y1="13" x2="14" y2="13"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Backup &amp; restore</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="system">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Updates</span>
            </span>
          </button>
        </nav>

        <div class="settings-foot">
          <span class="settings-version" id="settings-version">Rouen</span>
          <a class="settings-repo" id="settings-repo"
             href="https://github.com/meltface-80/MusicD-Remote"
             target="_blank" rel="noopener noreferrer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.36 9.36 0 0 1 2.5-.35c.85 0 1.71.12 2.5.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/>
            </svg>
            <span>View on GitHub</span>
          </a>
        </div>
      </div>

      <!-- Setup (v1.8.83): the app's own preferences, one page each. Every page
           listed here names it as its parent (data-parent), so its Back
           returns here rather than to the Settings list. -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Setup</h2>
        </div>
        <p class="settings-pane-desc">Smart Picks, record labels, the Home screen, the look, sharing, Discover, API keys</p>
        <nav class="settings-nav" aria-label="Setup pages">
          <button class="settings-nav-item" type="button" data-pane="smartpicks">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.5-4.5"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Smart Picks</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="labels">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Record labels</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="homescreen">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="12" width="18" height="5" rx="1"/><path d="M3 20h11"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Home Screen</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="ui">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 15h7M14 19h5"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">UI Settings</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="sharecard">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Share Card</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="discover">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">Discover</span>
            </span>
          </button>

          <button class="settings-nav-item" type="button" data-pane="metadata">
            <span class="settings-nav-ico" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </span>
            <span class="settings-nav-txt">
              <span class="settings-nav-title">API Keys</span>
            </span>
          </button>
        </nav>
      </div>

      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="playback">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Playback</h2>
        </div>
        <p class="settings-pane-desc">Zone, waveform &amp; radio</p>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Zone / output <button class="settings-info-btn" data-info="Which Roon zone Play, Queue, the transport and both radios act on. Chosen per device." aria-label="Info">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="zone-select" class="settings-select" aria-label="Output zone"></select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Waveform <button class="settings-info-btn" data-info="Off by default. Draws the shape of the track — how loud it is, moment to moment — on the Now playing progress bar and the wall display. Local files are read from your /music mount; Qobuz and TIDAL tracks are fetched with the account you connected under Services, analysed and thrown away. The first play of a track takes a second or two, the next track is prepared while this one plays, and every result is kept. A track that can&#x27;t be identified keeps the plain bar." aria-label="Info">&#9432;</button></span>
            <label class="switch">
              <input type="checkbox" id="waveform-enabled" aria-label="Waveform">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note" id="waveform-enabled-note">Off. The progress bar stays a plain line.</div>

          <!-- Qobuz waveforms. Off until the user signs in, and the sign-in
               happens on qobuz.com — no password or key is typed in here. -->
          <div class="settings-row" style="margin-top:12px">
            <span class="settings-label">Qobuz waveforms <button class="settings-info-btn" data-info="Waveforms for Qobuz tracks. Roon streams them straight to your endpoint, never to this extension, so the extension fetches the track itself with your Qobuz sign-in, reduces it to 4,000 loudness values and discards the audio. Needs Waveform switched on. TIDAL tracks work the same way through the TIDAL sign-in, with nothing to set here." aria-label="Info">ⓘ</button></span>
          </div>
          <div id="qobuz-secret-status" class="settings-token-status"></div>
        </div>

        <div class="settings-divider"></div>

        <!-- The two radios, together, because they answer the same question:
             what plays when this zone's queue runs out. Only one can be on. -->
        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Random album radio <button class="settings-info-btn" data-info="When this zone's queue ends, keep playing whole random albums — a never-ending random album radio. Turning this on turns Roon Radio off for the zone." aria-label="Info">ⓘ</button></span>
            <label class="switch">
              <input type="checkbox" id="radio-toggle" aria-label="Random album radio">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-row">
            <span class="settings-label">Roon Radio <button class="settings-info-btn" data-info="Roon's own keep-playing-forever feature: when the queue ends it keeps going with similar tracks. Turning this on turns Random album radio off for the zone — both fill the same queue, so only one can run." aria-label="Info">ⓘ</button></span>
            <label class="switch">
              <input type="checkbox" id="roon-radio-toggle" aria-label="Roon Radio">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Labels -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="labels" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>Record labels</h2>
        </div>
        <p class="settings-pane-desc">Label scan, ordering &amp; folders</p>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Record labels <button class="settings-info-btn" data-info="Off by default. When on, works out each album&#x27;s record label — file tags first, then Bandcamp, iTunes, TheAudioDB, MusicBrainz and Discogs (Qobuz for a streaming-only library) — fetches label logos, and turns on the Labels screen and the Label of the week row. When off, none of that runs. Your /music tags are still read either way, for the Format and sample-rate filters, release dates, waveforms and the local-files badge." aria-label="Info">ⓘ</button></span>
            <label class="switch">
              <input type="checkbox" id="labels-enabled" aria-label="Record labels">
              <span class="switch-track"><span class="switch-thumb"></span></span>
            </label>
          </div>
          <div class="settings-note" id="labels-enabled-note">Off by default. Everything below applies only while this is on.</div>
        </div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Label album order <button class="settings-info-btn" data-info="When you open a record label, list its albums alphabetically or shuffle them." aria-label="Info">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="label-order-select" class="settings-select" aria-label="Label album order">
                <option value="alpha">Alphabetical</option>
                <option value="random">Random</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Minimum albums per label <button class="settings-info-btn" data-info="Hide labels that have fewer albums than this threshold. Useful if the scanner picks up one-off compilations from unexpected labels." aria-label="Info">ⓘ</button></span>
            <div class="settings-select-wrap">
              <select id="label-min-select" class="settings-select" aria-label="Minimum albums per label">
                <option value="1">Show all</option>
                <option value="2">2 or more</option>
                <option value="5">5 or more</option>
                <option value="10">10 or more</option>
              </select>
              <svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Label data <button class="settings-info-btn" data-info="Forgets every album&#x27;s label and looks them all up again from every source. Use it if label data looks wrong — new albums are picked up by the normal scan. Logos, MusicBrainz IDs and merges are kept." aria-label="Info">ⓘ</button></span>
            <button id="force-rescan-btn" class="settings-update-btn" type="button">Force rescan</button>
          </div>
          <div id="force-rescan-status" class="settings-release-notes hidden"></div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Label from folder depth <button class="settings-info-btn" data-info="For local libraries filed in label folders. 0 = off (use each file's own label tag, the default). Otherwise the label is taken from the folder at this depth under your music root — e.g. /music/Jazz/Blue Note Records/Album is depth 2. Fixes reissues being split off under their pressing label (e.g. an album in your Blue Note folder showing as EMI Finland). Saving re-runs the label scan." aria-label="Info">ⓘ</button></span>
          </div>
          <div class="settings-token-row">
            <input id="label-folder-depth-input" type="number" min="0" max="6" class="settings-token-input" placeholder="0 = off (use file tag)">
            <button id="label-folder-depth-save" class="settings-update-btn" type="button">Save</button>
          </div>
          <div id="label-folder-depth-status" class="settings-token-status"></div>
        </div>
      </div>

      <!-- Artwork & metadata -->
      <div class="settings-view settings-pane hidden" data-view="pane" data-pane="metadata" data-parent="setup">
        <div class="settings-pane-head">
          <button class="settings-back" type="button" data-settings-back aria-label="Back to Setup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h2>API Keys</h2>
        </div>
        <p class="settings-pane-desc">Discogs, FanArt.tv &amp; Last.fm keys</p>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Discogs token <button class="settings-info-btn" data-info="A personal access token from discogs.com → Settings → Developers. Used for the Discogs label lookup, automatic label logos, the manual logo picker and, since v1.9.67, the catalogue number and kind (album, EP, single…) of albums whose file tags give none — looked up a few hundred per label scan, never over a tag. Optional. A ✓ in the box means Discogs accepted it." aria-label="Info">ⓘ</button></span>
          </div>
          <div class="settings-token-row">
            <span class="token-field">
              <input id="discogs-token-input" type="text" class="settings-token-input" placeholder="Paste personal access token…" autocomplete="off" spellcheck="false">
              <span id="discogs-token-check" class="token-check hidden" role="img"></span>
            </span>
            <button id="discogs-token-save" class="settings-update-btn" type="button">Save</button>
          </div>
          <div id="discogs-token-status" class="settings-token-status"></div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">FanArt.tv key <button class="settings-info-btn" data-info="A free personal API key from fanart.tv/get-an-api-key. Used for label logos and the wall display&#x27;s artist photos. Optional. A ✓ in the box means FanArt.tv accepted it." aria-label="Info">ⓘ</button></span>
          </div>
          <div class="settings-token-row">
            <span class="token-field">
              <input id="fanart-key-input" type="text" class="settings-token-input" placeholder="Paste FanArt.tv API key…" autocomplete="off" spellcheck="false">
              <span id="fanart-key-check" class="token-check hidden" role="img"></span>
            </span>
            <button id="fanart-key-save" class="settings-update-btn" type="button">Save</button>
          </div>
          <div id="fanart-key-status" class="settings-token-status"></div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-block">
          <div class="settings-row">
            <span class="settings-label">Last.fm key <button class="settings-info-btn" data-info="A free API key from last.fm/api/account/create (any application name will do). Used only to show similar artists and similar albums at the foot of the album view, and to open their Last.fm pages. Read-only: nothing is scrobbled — Roon does that. Optional. A ✓ in the box means Last.fm accepted it." aria-label="Info">ⓘ</button></span>
          </div>
          <div class="settings-token-row">
            <span class="token-field">
              <input id="lastfm-key-input" type="text" class="settings-token-input" placeholder="Paste Last.fm API key…" autocomplete="off" spellcheck="false">
              <span id="lastfm-key-check" class="token-check hidden" role="img"></span>
            </span>
            <button id="lastfm-key-save" class="settings-update-btn" type="button">Save</button>
          </div>
          <div id="lastfm-key-status" class="settings-token-status"></div>
        </div>
      </div>
    </div>
  </div>
`);
})();
