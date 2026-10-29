// The forwarder: a plain TCP port on the phone's loopback that leads to the
// server over the tailnet. The app uses http://127.0.0.1:<port> as its away
// address, so the WebView, the player and downloads need no proxy settings.
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"tailscale.com/tsnet"
)

// DialTimeout bounds how long a new connection waits for the server: past
// it the app gets a closed connection, the same as "unreachable" at home.
var DialTimeout = 4 * time.Second

type Forwarder struct {
	TS     *tsnet.Server
	Target string // server's tailnet address, e.g. 100.64.0.1:3500

	ln   net.Listener
	mu   sync.Mutex
	open map[net.Conn]struct{}
	down bool // the app's check found the server gone: refuse at once
}

// SetDown is the app's verdict: down drops what's in flight and refuses new
// connections immediately (no dial wait); up lets them through again.
func (f *Forwarder) SetDown(down bool) int {
	f.mu.Lock()
	f.down = down
	f.mu.Unlock()
	if down {
		return f.DropConnections()
	}
	return 0
}

// Start listens on 127.0.0.1 (a free port) and returns the address.
func (f *Forwarder) Start() (string, error) { return f.StartOn(0) }

// StartOn listens on 127.0.0.1:port — the same port every time, so the page
// keeps one address (its saved settings belong to it) — or on a free port if
// port is 0. A port that is taken is an error, never another port in its place
// (bug list item 158): the app goes on asking the port it named, its sign-in
// with every request, and whatever held it would have had them.
func (f *Forwarder) StartOn(port int) (string, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return "", err
	}
	f.ln = ln
	f.open = map[net.Conn]struct{}{}
	go f.accept()
	return ln.Addr().String(), nil
}

func (f *Forwarder) accept() {
	for {
		c, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.handle(c)
	}
}

func (f *Forwarder) track(c net.Conn, on bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if on {
		f.open[c] = struct{}{}
	} else {
		delete(f.open, c)
	}
}

func (f *Forwarder) handle(c net.Conn) {
	defer c.Close()
	f.mu.Lock()
	down := f.down
	f.mu.Unlock()
	if down {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), DialTimeout)
	up, err := f.TS.Dial(ctx, "tcp", f.Target)
	cancel()
	if err != nil {
		return // the app sees a closed connection: "server unreachable", as over Wi-Fi
	}
	defer up.Close()
	f.track(c, true)
	defer f.track(c, false)
	done := make(chan struct{}, 2)
	go func() { io.Copy(up, c); up.Close(); done <- struct{}{} }()
	go func() { io.Copy(c, up); c.Close(); done <- struct{}{} }()
	<-done
	<-done
}

// DropConnections closes every connection in flight (the app calls it when
// its own check finds the server gone), so nothing waits on a dead tunnel.
func (f *Forwarder) DropConnections() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := len(f.open)
	for c := range f.open {
		c.Close()
	}
	return n
}

// Probe asks the server directly over the tailnet (not through the gate), so
// the app can tell when it's back: true when /api/health answers 200.
func (f *Forwarder) Probe(timeout time.Duration) bool {
	hc := f.TS.HTTPClient()
	hc.Timeout = timeout
	res, err := hc.Get("http://" + f.Target + "/api/health")
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == 200
}

// Close stops listening and drops open connections.
func (f *Forwarder) Close() {
	if f.ln != nil {
		f.ln.Close()
	}
	f.mu.Lock()
	for c := range f.open {
		c.Close()
	}
	f.mu.Unlock()
}
