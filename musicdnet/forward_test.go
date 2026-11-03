package main

import (
	"net"
	"testing"
)

// Bug list item 158: the app's port taken by something else, the forwarder took another without a word, and the app
// went on sending to the port it named — its sign-in with every request — to whatever held it.
func TestForwarderRefusesATakenPort(t *testing.T) {
	squat, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer squat.Close()
	port := squat.Addr().(*net.TCPAddr).Port
	f := &Forwarder{}
	if addr, err := f.StartOn(port); err == nil {
		f.Close()
		t.Fatalf("port %d taken, yet the forwarder listens on %s", port, addr)
	}
	g := &Forwarder{}
	addr, err := g.StartOn(0)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	if addr == "" {
		t.Fatal("asked for any free port: no address")
	}
}
