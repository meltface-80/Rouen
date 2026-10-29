"use strict";
// An ffmpeg that passes its input through (v1.9.72-t5, lib/phone's tests): what goes into a decoder comes out as its
// "sound", byte for byte, and the encoder's output is what went in. So a session's file is its segments' input, in
// order, and a segment's length in ms is its input's bytes over the format's bytes per ms — exact, and checkable.
const { PassThrough } = require("node:stream");
const { EventEmitter } = require("node:events");

/** @param {Array<{ args: string[], child: any }>} [seen]  every process started, in order */
function fakeSpawn(seen) {
  return (bin, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.killed = false;
    child.stdin.pipe(child.stdout);
    let closed = false;
    const close = () => { if (!closed) { closed = true; setImmediate(() => child.emit("close", child.killed ? null : 0)); } };
    child.stdout.on("end", close);
    child.kill = () => { child.killed = true; child.stdin.destroy(); child.stdout.destroy(); close(); };
    if (seen) seen.push({ args, child });
    return child;
  };
}

module.exports = { fakeSpawn };
