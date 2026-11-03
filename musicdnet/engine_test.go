package main

// The engine, driven through its control API as the app drives it, against a
// private tailnet (Tailscale's own test control server and relay) and a
// stand-in for MusicD reached through a server node — the paths the phone
// uses away from home. Run on every Android build.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"tailscale.com/net/netns"
	"tailscale.com/tailcfg"
	"tailscale.com/tsnet"
	"tailscale.com/tstest/integration"
	"tailscale.com/tstest/integration/testcontrol"
	"tailscale.com/types/logger"
)

func startControl(t *testing.T) (string, *testcontrol.Server) {
	netns.SetEnabled(false)
	c := &testcontrol.Server{
		DERPMap:        integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1"),
		DNSConfig:      &tailcfg.DNSConfig{Proxied: true},
		MagicDNSDomain: "tail-scale.ts.net",
		RequireAuth:    true,
		Logf:           logger.Discard,
	}
	c.HTTPTestServer = httptest.NewUnstartedServer(c)
	c.HTTPTestServer.Start()
	t.Cleanup(c.HTTPTestServer.Close)
	return c.HTTPTestServer.URL, c
}

// A stand-in for MusicD: health, a held request, a large file with ranges,
// and who it thinks is asking.
func musicd(t *testing.T) string {
	audio := strings.Repeat("0123456789", 100_000) // 1 MB
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"ok":true}`) })
	mux.HandleFunc("/api/whoami", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, r.Header.Get("X-Forwarded-For"))
	})
	mux.HandleFunc("/api/hold", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(3 * time.Second):
		case <-r.Context().Done():
		}
		io.WriteString(w, "held")
	})
	mux.HandleFunc("/stream/t1.flac", func(w http.ResponseWriter, r *http.Request) {
		http.ServeContent(w, r, "t1.flac", time.Now(), strings.NewReader(audio))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

// The server's node: a second engine as MusicD Server runs it (-server), joined
// through its control API and serving :3500 — each request passed to MusicD
// with the caller's tailnet address in X-Forwarded-For.
func serverNode(t *testing.T, ctx context.Context, control *testcontrol.Server, controlURL, dir, upstream string) (*tsnet.Server, string) {
	se := &engine{dir: dir}
	ctl := httptest.NewServer(se.handler("srv"))
	t.Cleanup(ctl.Close)
	a := api{t, ctl.URL, "srv"}
	if code, m := a.call("POST", "/start", `{"ControlURL":"`+controlURL+`","Hostname":"musicd"}`); code != 200 {
		t.Fatalf("server start: %d %v", code, m)
	}
	var ip string
	for i := 0; i < 600 && ip == ""; i++ {
		_, st := a.call("GET", "/status", "")
		if u, _ := st["auth_url"].(string); u != "" && st["state"] == "NeedsLogin" {
			control.CompleteAuth(u)
		}
		if ips, _ := st["ips"].([]any); st["state"] == "Running" && len(ips) > 0 {
			ip = ips[0].(string)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if ip == "" {
		t.Fatal("server node never came up")
	}
	code, m := a.call("POST", "/serve?port=3500&upstream="+url.QueryEscape(upstream), "")
	if code != 200 || !strings.HasSuffix(m["addr"].(string), ":3500") {
		t.Fatalf("serve: %d %v", code, m)
	}
	if _, st := a.call("GET", "/status", ""); !strings.HasSuffix(st["serving"].(string), ":3500") {
		t.Fatalf("status doesn't say it's serving: %v", st)
	}
	return se.ts, ip
}

type api struct {
	t      *testing.T
	base   string
	secret string
}

func (a api) call(method, path, body string) (int, map[string]any) {
	req, _ := http.NewRequest(method, a.base+path, strings.NewReader(body))
	req.Header.Set("X-Secret", a.secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		a.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	var m map[string]any
	json.NewDecoder(res.Body).Decode(&m)
	return res.StatusCode, m
}

func javaStyleInterfaces() string {
	ifs, _ := net.Interfaces()
	var b strings.Builder
	for _, i := range ifs {
		fl := []string{}
		if i.Flags&net.FlagUp != 0 {
			fl = append(fl, "up")
		}
		if i.Flags&net.FlagLoopback != 0 {
			fl = append(fl, "loopback")
		}
		if i.Flags&net.FlagMulticast != 0 {
			fl = append(fl, "multicast")
		}
		if len(fl) == 0 {
			fl = []string{"none"}
		}
		var as []string
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			as = append(as, a.String())
		}
		fmt.Fprintf(&b, "%s %d %d %s %s\n", i.Name, i.Index, i.MTU, strings.Join(fl, "|"), strings.Join(as, ","))
	}
	return b.String()
}

func TestEngine(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	controlURL, control := startControl(t)
	upstream := musicd(t)
	tmp := t.TempDir()
	server, serverIP := serverNode(t, ctx, control, controlURL, filepath.Join(tmp, "server"), upstream)
	target := serverIP + ":3500"

	InstallInterfaceGetter()
	e := &engine{dir: filepath.Join(tmp, "phone")}
	ctl := httptest.NewServer(e.handler("s3cret"))
	defer ctl.Close()
	a := api{t: t, base: ctl.URL, secret: "s3cret"}

	t.Run("control API refuses without the secret", func(t *testing.T) {
		if code, _ := (api{t: t, base: ctl.URL, secret: "wrong"}).call("GET", "/status", ""); code != 403 {
			t.Fatalf("got %d", code)
		}
	})

	t.Run("interfaces handed over, then sign-in by link", func(t *testing.T) {
		if code, _ := a.call("POST", "/interfaces", javaStyleInterfaces()); code != 200 {
			t.Fatalf("interfaces: %d", code)
		}
		if code, m := a.call("POST", "/start", fmt.Sprintf(`{"ControlURL":%q}`, controlURL)); code != 200 {
			t.Fatalf("start: %d %v", code, m)
		}
		var state string
		for i := 0; i < 600; i++ {
			_, st := a.call("GET", "/status", "")
			state, _ = st["state"].(string)
			if link, _ := st["auth_url"].(string); state == "NeedsLogin" && link != "" {
				control.CompleteAuth(link) // the person signing in on the Tailscale page
			}
			if state == "Running" {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatalf("never Running (last %s)", state)
	})

	var base string
	t.Run("forward, and MusicD sees the phone's tailnet address", func(t *testing.T) {
		code, m := a.call("POST", "/forward?target="+target+"&port=34599", "")
		if code != 200 {
			t.Fatalf("forward: %d %v", code, m)
		}
		base = "http://" + m["addr"].(string)
		if m["addr"] != "127.0.0.1:34599" {
			t.Fatalf("asked for port 34599, got %v", m["addr"])
		}
		res, err := http.Get(base + "/api/whoami")
		if err != nil {
			t.Fatal(err)
		}
		who, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !strings.HasPrefix(string(who), "100.") {
			t.Fatalf("MusicD saw %q, want a 100.x tailnet address", who)
		}
		if _, m := a.call("GET", "/probe", ""); m["ok"] != true {
			t.Fatalf("probe: %v", m)
		}
		// The app's page relay speaks to it as to a web proxy: the whole address in the request line.
		c, err := net.Dial("tcp", m2addr(base))
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(c, "GET http://192.168.1.10:3500/api/whoami HTTP/1.1\r\nHost: 192.168.1.10:3500\r\nConnection: close\r\n\r\n")
		raw, _ := io.ReadAll(c)
		c.Close()
		if !strings.Contains(string(raw), "200 OK") || !strings.Contains(string(raw), "\r\n\r\n100.") {
			t.Fatalf("relayed request: %q", raw)
		}
	})

	t.Run("a network change is passed on to Tailscale; a rebind keeps the way through", func(t *testing.T) {
		if monitorOf(e.ts) == nil {
			t.Fatal("tsnet's network monitor not found (a Tailscale upgrade moved it?)")
		}
		desc := javaStyleInterfaces()
		if _, m := a.call("POST", "/interfaces", desc); m["changed"] != false {
			t.Fatalf("the same list again: %v", m)
		}
		if _, m := a.call("POST", "/interfaces", desc+"default wlan0\n"); m["changed"] != true {
			t.Fatalf("a new default route: %v", m)
		}
		if DefaultRoute() != "wlan0" {
			t.Fatalf("default route %q", DefaultRoute())
		}
		if code, m := a.call("POST", "/rebind", ""); code != 200 {
			t.Fatalf("rebind: %d %v", code, m)
		}
		ok := false
		for i := 0; i < 20 && !ok; i++ {
			_, m := a.call("GET", "/probe", "")
			ok = m["ok"] == true
		}
		if !ok {
			t.Fatal("server not answering after a rebind")
		}
		res, err := http.Get(base + "/api/health")
		if err != nil || res.StatusCode != 200 {
			t.Fatalf("through the forward after a rebind: %v %v", err, res)
		}
		res.Body.Close()
	})

	t.Run("audio with ranges, and a held request", func(t *testing.T) {
		req, _ := http.NewRequest("GET", base+"/stream/t1.flac", nil)
		req.Header.Set("Range", "bytes=1000-1999")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 206 || len(b) != 1000 {
			t.Fatalf("range: %d %d", res.StatusCode, len(b))
		}
		t0 := time.Now()
		res, err = http.Get(base + "/api/hold")
		if err != nil || time.Since(t0) < 2500*time.Millisecond {
			t.Fatalf("held request: %v after %v", err, time.Since(t0))
		}
		res.Body.Close()
	})

	t.Run("server gone: probe says so, down drops what's waiting at once; back: through again", func(t *testing.T) {
		waiting := make(chan error, 1)
		go func() {
			res, err := (&http.Client{Timeout: 30 * time.Second}).Get(base + "/api/hold")
			if err == nil {
				res.Body.Close()
				err = fmt.Errorf("finished normally")
			}
			waiting <- err
		}()
		time.Sleep(300 * time.Millisecond)
		server.Close()
		if _, m := a.call("GET", "/probe", ""); m["ok"] != false {
			t.Fatalf("probe while down: %v", m)
		}
		a.call("POST", "/down?on=1", "")
		select {
		case <-waiting:
		case <-time.After(2 * time.Second):
			t.Fatal("held request still waiting after down")
		}
		s2, ip2 := serverNode(t, ctx, control, controlURL, filepath.Join(tmp, "server"), upstream)
		defer s2.Close()
		if ip2 != serverIP {
			t.Fatalf("server address changed: %s → %s", serverIP, ip2)
		}
		ok := false
		for i := 0; i < 40 && !ok; i++ {
			_, m := a.call("GET", "/probe", "")
			ok = m["ok"] == true
		}
		if !ok {
			t.Fatal("probe never saw the server back")
		}
		a.call("POST", "/down?on=0", "")
		res, err := http.Get(base + "/api/health")
		if err != nil || res.StatusCode != 200 {
			t.Fatalf("after return: %v %v", err, res)
		}
		res.Body.Close()
	})

	t.Run("log has lines for the diagnostics screen", func(t *testing.T) {
		req, _ := http.NewRequest("GET", ctl.URL+"/log", nil)
		req.Header.Set("X-Secret", "s3cret")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if len(b) == 0 {
			t.Fatal("empty log")
		}
	})
}

func m2addr(base string) string { return strings.TrimPrefix(base, "http://") }
