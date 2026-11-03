# Tailscale built in (v1.9.72-t7, dev/design/android-app.md §4.7): Mandarin's own engine, musicdnet (musicdnet/,
# Go, tailscale.com/tsnet), built for the image's platform on the builder's own (no emulation), as Mandarin's
# Dockerfile builds it. Rouen runs it (lib/tailscale/node.js): signed in from Settings → Setup → Away from home, or
# with TS_AUTHKEY, it puts Rouen on your tailnet by itself. Docker Hub's official images through Google's mirror of
# them, as Mandarin's: the same images without Docker Hub's limit on anonymous pulls.
FROM --platform=$BUILDPLATFORM mirror.gcr.io/library/golang:1.26-bookworm AS tsnet
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY musicdnet/go.mod musicdnet/go.sum ./
RUN go mod download
COPY musicdnet/*.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags "-s -w -X main.version=server" -o /out/musicdnet .

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y git tar python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# Quiet, production-only install: no audit/fund/update-notifier chatter, and
# warn-level noise (e.g. better-sqlite3's transitive prebuild-install
# deprecation, which even its latest release still ships) suppressed — real
# errors still print. Vulnerable/deprecated deps are fixed in package.json
# itself (music-metadata >=11 clears both audit findings; node-uuid is
# overridden with the maintained uuid package).
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error

COPY . .

COPY --from=tsnet /out/musicdnet /usr/local/bin/musicdnet

RUN mkdir -p /app/data/cache

VOLUME /app/data

EXPOSE 3399

ENV PORT=3399
ENV DOCKER=1

# The published image names itself (v1.8.70): the workflows build with
# --build-arg MUSICD_IMAGE=ghcr.io/<owner>/<name>, and the app then offers
# `docker pull` of that image as well as its one-tap update (v1.8.71). A local
# `docker build .` leaves it empty and offers the one-tap update alone.
# Last, so a change to it never invalidates the npm install layer above.
ARG MUSICD_IMAGE=""
ENV MUSICD_IMAGE=$MUSICD_IMAGE

CMD ["npm","start"]
