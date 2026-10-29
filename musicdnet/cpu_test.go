package main

import (
	"encoding/json"
	"testing"
)

// The engine says how much CPU it has used, in /status (item 202).
func TestCPUSeconds(t *testing.T) {
	c := cpuSeconds()
	if c < 0 {
		t.Fatalf("cpuSeconds %v", c)
	}
	// Some work, then more.
	x := 0
	for i := 0; i < 20_000_000; i++ {
		x += i % 7
	}
	if d := cpuSeconds(); d < c || x == 0 {
		t.Fatalf("cpu went from %v to %v", c, d)
	}
	b, err := json.Marshal(statusJSON{CPU: 1.5})
	if err != nil || string(b) == "" || !json.Valid(b) {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(b, &m)
	if m["cpu_s"] != 1.5 {
		t.Fatalf("status without cpu_s: %s", b)
	}
}
