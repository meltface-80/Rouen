// musicdnet is MusicD's own Tailscale connection — on the phone, and (with
// -server) inside MusicD Server's image, where it makes the server a node of
// your tailnet by itself: no Tailscale on the machine it runs on.
//
// The Android app runs it as a separate program (shipped in the APK as
// libmusicdnet.so, the way Syncthing for Android runs its engine): it joins
// your tailnet as the phone, with no VPN, and gives the app a loopback port
// that leads to the server. The app drives it over a small HTTP API on
// 127.0.0.1, guarded by a secret the app passes in the environment. It exits
// when the app does (its stdin, held open by the app, closes).
//
//	GET  /status               state, sign-in link, tailnet addresses
//	POST /interfaces           the phone's interfaces and default route, as text
//	                           (Android 11+ doesn't let native code list them);
//	                           a change makes Tailscale look at the network again
//	POST /rebind               the server isn't answering: rebind Tailscale's
//	                           sockets and find its addresses again
//	POST /start                join (body: {"control_url","auth_key","hostname"})
//	POST /login                ask for a sign-in link (after an expiry, say)
//	POST /logout               sign this phone out of the tailnet
//	POST /forward?target=ip:port[&port=n]   open the loopback port (n, or an error if taken) → {"addr"}
//	GET  /probe                is the server answering, directly? → {"ok","ms"}
//	POST /down?on=1|0          the app's verdict: drop and refuse, or let through
//	GET  /log                  recent log lines, for the diagnostics screen
//	POST /serve?port=n&upstream=http://127.0.0.1:n   (the server) take the tailnet's
//	                           port n and pass each request to MusicD, with the
//	                           caller's tailnet address in X-Forwarded-For
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"tailscale.com/tsnet"
)

type engine struct {
	dir string

	mu    sync.Mutex
	ts    *tsnet.Server
	fw    *Forwarder
	serve net.Listener // the server's tailnet port, when serving
	err   string

	logMu sync.Mutex
	lines []string
}

func (e *engine) logf(format string, a ...any) {
	line := time.Now().Format("15:04:05 ") + fmt.Sprintf(format, a...)
	e.logMu.Lock()
	e.lines = append(e.lines, line)
	if len(e.lines) > 400 {
		e.lines = e.lines[len(e.lines)-400:]
	}
	e.logMu.Unlock()
}

func (e *engine) start(controlURL, authKey, hostname string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.ts != nil {
		return nil
	}
	if hostname == "" {
		hostname = "musicd-phone"
	}
	s := &tsnet.Server{
		Dir:        e.dir,
		Hostname:   hostname,
		ControlURL: controlURL,
		AuthKey:    authKey,
		Logf:       func(f string, a ...any) { e.logf(f, a...) },
		UserLogf:   func(f string, a ...any) { e.logf(f, a...) },
	}
	if err := s.Start(); err != nil {
		e.err = err.Error()
		return err
	}
	e.ts = s
	e.err = ""
	return nil
}

func (e *engine) forward(target string, port int) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.ts == nil {
		return "", fmt.Errorf("not started")
	}
	if e.fw != nil && e.fw.Target == target && (port == 0 || e.fw.ln.Addr().(*net.TCPAddr).Port == port) {
		return e.fw.ln.Addr().String(), nil
	}
	if e.fw != nil {
		e.fw.Close()
	}
	fw := &Forwarder{TS: e.ts, Target: target}
	addr, err := fw.StartOn(port)
	if err != nil {
		return "", err
	}
	e.fw = fw
	return addr, nil
}

// serve takes the tailnet's port and passes every request on to upstream (MusicD
// on 127.0.0.1): streamed as it comes (audio, held requests), with the caller's
// tailnet address added to X-Forwarded-For — the server believes that header
// only from 127.0.0.1, and treats any tailnet address as away from home.
func (e *engine) serveOn(port int, upstream string) (string, error) {
	u, err := url.Parse(upstream)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("upstream must be http://host:port")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.ts == nil {
		return "", fmt.Errorf("not started")
	}
	if e.serve != nil {
		return e.serve.Addr().String(), nil
	}
	ln, err := e.ts.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return "", err
	}
	rp := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(u)
			r.Out.Host = r.In.Host
			r.SetXForwarded()
		},
		FlushInterval: -1,
		ErrorLog:      log.New(io.Discard, "", 0),
	}
	e.serve = ln
	go (&http.Server{Handler: rp, ReadHeaderTimeout: 30 * time.Second}).Serve(ln)
	return ln.Addr().String(), nil
}

var version = "dev"

func main() {
	dir := flag.String("dir", "", "state directory")
	server := flag.Bool("server", false, "run as MusicD Server's own node (not a phone)")
	flag.Parse()
	secret := os.Getenv("MUSICDNET_SECRET")
	if *dir == "" || secret == "" {
		fmt.Fprintln(os.Stderr, "usage: MUSICDNET_SECRET=… musicdnet -dir <state dir>")
		os.Exit(2)
	}
	os.MkdirAll(*dir, 0o700)
	log.SetOutput(io.Discard) // Tailscale's own logging goes to the ring buffer
	if !*server {
		InstallInterfaceGetter() // Android 11+ won't let native code list interfaces
	}
	e := &engine{dir: *dir}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// The app reads this first line to find the control port.
	fmt.Printf("CONTROL %d\n", ln.Addr().(*net.TCPAddr).Port)

	// The app holds stdin open; when it goes, so do we.
	go func() {
		io.Copy(io.Discard, os.Stdin)
		os.Exit(0)
	}()

	http.Serve(ln, e.handler(secret))
}

func (e *engine) handler(secret string) http.Handler {
	mux := http.NewServeMux()
	reply := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
	fail := func(w http.ResponseWriter, code int, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		reply(w, e.status(ctx))
	})
	mux.HandleFunc("POST /interfaces", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
		changed, err := SetInterfaces(string(b))
		if err != nil {
			fail(w, 400, err)
			return
		}
		if changed {
			e.netChanged()
		}
		reply(w, map[string]bool{"ok": true, "changed": changed})
	})
	mux.HandleFunc("POST /rebind", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if err := e.rebind(ctx); err != nil {
			fail(w, 500, err)
			return
		}
		reply(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /start", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ ControlURL, AuthKey, Hostname string }
		json.NewDecoder(r.Body).Decode(&in)
		if err := e.start(in.ControlURL, in.AuthKey, in.Hostname); err != nil {
			fail(w, 500, err)
			return
		}
		reply(w, e.status(r.Context()))
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		e.mu.Lock()
		ts := e.ts
		e.mu.Unlock()
		if ts == nil {
			fail(w, 409, fmt.Errorf("not started"))
			return
		}
		lc, err := ts.LocalClient()
		if err == nil {
			err = lc.StartLoginInteractive(r.Context())
		}
		if err != nil {
			fail(w, 500, err)
			return
		}
		// The link arrives shortly after.
		for i := 0; i < 50; i++ {
			if st := e.status(r.Context()); st.AuthURL != "" || st.State == "Running" {
				reply(w, st)
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		reply(w, e.status(r.Context()))
	})
	mux.HandleFunc("POST /logout", func(w http.ResponseWriter, r *http.Request) {
		e.mu.Lock()
		ts := e.ts
		e.mu.Unlock()
		if ts == nil {
			reply(w, e.status(r.Context()))
			return
		}
		lc, err := ts.LocalClient()
		if err == nil {
			err = lc.Logout(r.Context())
		}
		if err != nil {
			fail(w, 500, err)
			return
		}
		reply(w, e.status(r.Context()))
	})
	mux.HandleFunc("POST /forward", func(w http.ResponseWriter, r *http.Request) {
		target := r.URL.Query().Get("target")
		if _, _, err := net.SplitHostPort(target); err != nil {
			fail(w, 400, fmt.Errorf("target must be ip:port"))
			return
		}
		port, _ := strconv.Atoi(r.URL.Query().Get("port"))
		addr, err := e.forward(target, port)
		if err != nil {
			fail(w, 409, err)
			return
		}
		reply(w, map[string]string{"addr": addr})
	})
	mux.HandleFunc("POST /serve", func(w http.ResponseWriter, r *http.Request) {
		port, _ := strconv.Atoi(r.URL.Query().Get("port"))
		if port <= 0 || port > 65535 {
			fail(w, 400, fmt.Errorf("port must be 1-65535"))
			return
		}
		addr, err := e.serveOn(port, r.URL.Query().Get("upstream"))
		if err != nil {
			fail(w, 409, err)
			return
		}
		reply(w, map[string]string{"addr": addr})
	})
	mux.HandleFunc("GET /probe", func(w http.ResponseWriter, r *http.Request) {
		e.mu.Lock()
		fw := e.fw
		e.mu.Unlock()
		if fw == nil {
			fail(w, 409, fmt.Errorf("no forward yet"))
			return
		}
		t0 := time.Now()
		ok := fw.Probe(4 * time.Second)
		reply(w, map[string]any{"ok": ok, "ms": time.Since(t0).Milliseconds()})
	})
	mux.HandleFunc("POST /down", func(w http.ResponseWriter, r *http.Request) {
		e.mu.Lock()
		fw := e.fw
		e.mu.Unlock()
		if fw == nil {
			reply(w, map[string]int{"dropped": 0})
			return
		}
		reply(w, map[string]int{"dropped": fw.SetDown(r.URL.Query().Get("on") == "1")})
	})
	mux.HandleFunc("GET /log", func(w http.ResponseWriter, r *http.Request) {
		e.logMu.Lock()
		text := strings.Join(e.lines, "\n")
		e.logMu.Unlock()
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, text)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Secret")), []byte(secret)) != 1 {
			http.Error(w, "forbidden", 403)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
