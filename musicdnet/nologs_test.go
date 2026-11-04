package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"tailscale.com/logtail"
)

// THE one: after noUpload, a log line written to a logtail logger never reaches the log server, and the upload
// buffers an earlier run left are gone.
func TestNoUploadSendsNothing(t *testing.T) {
	var posts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts.Add(1)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	dir := t.TempDir()
	for _, f := range uploadBuffers {
		if err := os.WriteFile(filepath.Join(dir, f), []byte(`{"text":"left from before"}`+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	noUpload(dir)
	for _, f := range uploadBuffers {
		if _, err := os.Stat(filepath.Join(dir, f)); !os.IsNotExist(err) {
			t.Errorf("%s is still there to be sent: %v", f, err)
		}
	}

	lg := logtail.NewLogger(logtail.Config{
		Collection:   "rouen-test.logtail.io",
		BaseURL:      srv.URL,
		HTTPC:        srv.Client(),
		FlushDelayFn: func() time.Duration { return 0 },
	}, t.Logf)
	lg.Logf("a line that must not be sent")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	lg.Shutdown(ctx)
	if n := posts.Load(); n != 0 {
		t.Fatalf("the log server was sent %d upload(s)", n)
	}
}
