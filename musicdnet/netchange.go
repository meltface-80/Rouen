// Telling Tailscale the phone's network changed.
//
// On Android, Tailscale's network monitor doesn't watch the network itself:
// it re-reads the interfaces only every ten minutes and expects its host app
// to say when the network changes and which interface is the default route
// (the Tailscale app does this from Android's ConnectivityManager). Until
// v0.5.48 MusicD's engine was handed the new interface list but never told to
// look at it, so after Wi-Fi to mobile data, a new mobile address or another
// VPN coming on, its tunnel kept using sockets on the old network — for up to
// ten minutes — and the app saw the server as unreachable.
//
// Now each new list that differs from the last makes the monitor look again
// (it acts only if the state really changed, so a signal-strength callback
// costs nothing), and the app can ask for a full rebind when the server
// doesn't answer.
package main

import (
	"context"
	"reflect"
	"unsafe"

	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
)

// monitorOf is the tsnet server's network monitor. tsnet keeps it private and
// doesn't register it in Sys(), so it's read from the field; TestMonitorOf
// fails if a Tailscale upgrade moves it.
func monitorOf(s *tsnet.Server) *netmon.Monitor {
	if s == nil {
		return nil
	}
	f := reflect.ValueOf(s).Elem().FieldByName("netMon")
	if !f.IsValid() || f.Type() != reflect.TypeOf((*netmon.Monitor)(nil)) {
		return nil
	}
	return *(**netmon.Monitor)(unsafe.Pointer(f.UnsafeAddr()))
}

// netChanged: the phone's interfaces or default route differ from before.
// The monitor re-reads them and, if the state really differs, Tailscale
// rebinds its sockets, finds its addresses again and reconnects its relay.
func (e *engine) netChanged() {
	e.mu.Lock()
	ts := e.ts
	e.mu.Unlock()
	if m := monitorOf(ts); m != nil {
		m.Poll()
		e.logf("musicdnet: network changed (default route %q); Tailscale looks again", DefaultRoute())
	}
}

// rebind: the app's check found the server not answering. Re-read the
// network, then make Tailscale rebind its sockets and find its addresses
// again, whatever the monitor thinks — a tunnel can go stale with nothing
// on the phone having changed (a carrier's NAT dropping its mapping).
func (e *engine) rebind(ctx context.Context) error {
	e.mu.Lock()
	ts := e.ts
	e.mu.Unlock()
	if ts == nil {
		return nil
	}
	if m := monitorOf(ts); m != nil {
		m.InjectEvent()
	}
	lc, err := ts.LocalClient()
	if err != nil {
		return err
	}
	if err := lc.DebugAction(ctx, "rebind"); err != nil {
		return err
	}
	e.logf("musicdnet: rebound on the app's request")
	return lc.DebugAction(ctx, "restun")
}
