//go:build !android

package main

// setDefaultRoute: only Android's Tailscale takes the default route from the
// app; elsewhere (the server, the tests) it finds it itself.
func setDefaultRoute(name string) {}
