//go:build android

package main

import "tailscale.com/net/netmon"

// setDefaultRoute tells Tailscale which interface carries the phone's
// traffic now, as the Tailscale app does from ConnectivityManager.
func setDefaultRoute(name string) { netmon.UpdateLastKnownDefaultRouteInterface(name) }
