package main

import "testing"

// Rouen Lite runs this engine as a server, on Android (Rouen's dev/design/rouen-lite.md §5.1). Android 11+ won't let
// native code list interfaces, so there the app's list must be used in either mode; the review of 2.0.6-t10 found the
// getter installed for a phone only, which left Lite's engine with no network to see.
func TestUseAppInterfaces(t *testing.T) {
	cases := []struct {
		server bool
		goos   string
		want   bool
	}{
		{false, "android", true}, // the Rouen Android app
		{true, "android", true},  // THE one: Rouen Lite
		{true, "linux", false},   // a Docker Rouen lists its own
		{true, "windows", false}, // the Windows build too
	}
	for _, c := range cases {
		if got := useAppInterfaces(c.server, c.goos); got != c.want {
			t.Errorf("useAppInterfaces(%v, %q) = %v, want %v", c.server, c.goos, got, c.want)
		}
	}
}
