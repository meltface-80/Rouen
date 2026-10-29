// The engine's state as the app reads it (GET /status): Tailscale's backend
// state and sign-in link, the addresses, what is forwarded or served, and the
// engine's own CPU time (item 202).
package main

import "context"

type statusJSON struct {
	State   string   `json:"state"`
	AuthURL string   `json:"auth_url"`
	IPs     []string `json:"ips"`
	DNSName string   `json:"dns_name"`
	Forward string   `json:"forward"`
	Target  string   `json:"target"`
	Serving string   `json:"serving"`
	Error   string   `json:"error"`
	Version string   `json:"version"`
	// Online: this node is reachable on the tailnet as the control plane sees
	// it — false while a tunnel has gone stale though the state says Running.
	// Health: Tailscale's own warnings, empty when all is well.
	Online bool     `json:"online"`
	Health []string `json:"health"`
	// CPU: this process's CPU time so far, in seconds (user and system), for the
	// app's snapshots: Android ended the app for the engine's CPU once (item 202).
	CPU float64 `json:"cpu_s"`
}

func (e *engine) status(ctx context.Context) statusJSON {
	e.mu.Lock()
	ts, fw, errText := e.ts, e.fw, e.err
	e.mu.Unlock()
	out := statusJSON{State: "Stopped", Error: errText, Version: version, CPU: cpuSeconds()}
	if fw != nil && fw.ln != nil {
		out.Forward = fw.ln.Addr().String()
		out.Target = fw.Target
	}
	e.mu.Lock()
	if e.serve != nil {
		out.Serving = e.serve.Addr().String()
	}
	e.mu.Unlock()
	if ts == nil {
		return out
	}
	lc, err := ts.LocalClient()
	if err != nil {
		out.State = "Starting"
		return out
	}
	st, err := lc.Status(ctx)
	if err != nil {
		out.State = "Starting"
		return out
	}
	out.State = st.BackendState
	out.AuthURL = st.AuthURL
	for _, ip := range st.TailscaleIPs {
		out.IPs = append(out.IPs, ip.String())
	}
	if st.Self != nil {
		out.DNSName = st.Self.DNSName
		out.Online = st.Self.Online
	}
	out.Health = append([]string{}, st.Health...)
	return out
}
