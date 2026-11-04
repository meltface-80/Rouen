package main

// No diagnostic upload (v2.0.1-t3, dev/design/android-app.md §4.7). The owner, 2026-11-04, after a user's firewall
// showed Rouen reaching log.tailscale.io: tsnet uploads Tailscale's own logs to Tailscale's log server, and in this
// version (1.102.5) it does so whatever TS_NO_LOGS_NO_SUPPORT says (tsnet's startLogger does not read it). logtail's
// process-wide Disable drops every line before it is buffered, so nothing is sent. The lines an earlier run left in
// tsnet's upload buffer (tailscaled.log1.txt and .log2.txt beside the state) would still be drained and sent, so they
// are removed before the engine starts. The engine's own ring buffer (/log, the app's saved log) is untouched.

import (
	"os"
	"path/filepath"

	"tailscale.com/logtail"
)

// uploadBuffers are the files tsnet's log uploader keeps in the state directory (logtail/filch: "tailscaled" + .logN.txt).
var uploadBuffers = []string{"tailscaled.log1.txt", "tailscaled.log2.txt"}

// noUpload stops Tailscale's log upload for this process and removes what an earlier run left waiting to be sent.
func noUpload(dir string) {
	logtail.Disable()
	for _, f := range uploadBuffers {
		os.Remove(filepath.Join(dir, f)) // not there is as good: nothing to send
	}
}
