// @ts-check
"use strict";
/*
 * roon-releases.js — what Rouen keeps of a walk of Roon's edit info (lib/roon-direct/edit-facts.js, v1.9.67-t4,
 * dev/design/catalogue.md §4): the release-facts cache's "roon" layer, replaced whole as the file walk replaces its
 * own, and Roon's label for the albums the label scan left none for. Out of index.js so it is tested (the review).
 *
 *   createRoonReleases(deps).keep(records, whole)   → { kept, labelled }
 *
 * A walk cut short keeps nothing. A record that says nothing (Roon's Unknown type, no number) takes no key, so it
 * neither shadows a sibling under a shared key (two editions of one album) nor holds a stale number: a key no record
 * of the walk fills is dropped from the layer. Labels only with Labels on in Settings (the scan's own contract: off
 * means none of it runs), the first of Roon's that is plainly a label, never over a label known. Everything in one
 * transaction (a library of thirteen thousand albums is tens of thousands of rows).
 */

/**
 * @typedef {{ title: string, artist: string, catno: string | null, types: string[], labels: string[] }} RoonRelease
 * @param {{ facts: { replaceSource: (src: string, entries: Map<string, { catno: string | null, types: string[] }>) => number },
 *           keysOf: (title: string, artist: string) => string[], labelKey: (title: string, artist: string) => string,
 *           labelOf: (title: string, artist: string) => string | null, setLabel: (key: string, label: string) => void,
 *           isLabel: (name: string) => boolean, labelsOn: () => boolean, transaction?: (fn: () => void) => void,
 *           onLabels?: () => void, onChange?: () => void, log?: (line: string) => void }} d
 *   keysOf: every key an album is looked up by (the badge's); labelKey: the label cache's key; labelOf: the label Rouen
 *   has for an album, if any; setLabel: the label cache's write; isLabel: not plainly something else (a management
 *   company); transaction: the database's, around every write; onLabels: the Labels screen's rebuild; onChange: the
 *   Library's and the Shelf's answers moved
 */
function createRoonReleases(d) {
  const log = d.log || (() => {});
  const transaction = d.transaction || ((/** @type {() => void} */ fn) => { fn(); });
  return {
    /** @param {RoonRelease[]} records @param {boolean} whole @returns {{ kept: number, labelled: number }} */
    keep(records, whole) {
      if (!whole) return { kept: 0, labelled: 0 };
      /** @type {Map<string, { catno: string | null, types: string[] }>} */
      const entries = new Map();
      /** @type {Array<[string, string]>} */
      const labels = [];
      const labelsOn = d.labelsOn();
      for (const r of records) {
        if (r.catno || r.types.length) {
          for (const k of d.keysOf(r.title, r.artist)) if (!entries.has(k)) entries.set(k, { catno: r.catno, types: r.types });
        }
        if (!labelsOn || !r.labels.length || d.labelOf(r.title, r.artist)) continue;
        const label = r.labels.find((l) => d.isLabel(l));
        if (label) labels.push([d.labelKey(r.title, r.artist), label]);
      }
      let kept = 0;
      transaction(() => {
        kept = d.facts.replaceSource("roon", entries);
        for (const [key, label] of labels) d.setLabel(key, label);
      });
      if (labels.length && d.onLabels) d.onLabels();
      if ((kept || labels.length) && d.onChange) d.onChange();
      log(`Roon: ${records.length} albums read, ${kept} changed their catalogue number or kinds, ${labels.length} given a label`);
      return { kept, labelled: labels.length };
    },
  };
}

module.exports = { createRoonReleases };
