//go:build windows

package main

// cpuSeconds: not read on Windows, where the engine doesn't run.
func cpuSeconds() float64 { return -1 }
