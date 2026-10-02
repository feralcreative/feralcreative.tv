# feralcreative.tv

Feral Creative's TV network: a signed-in channel dashboard linking to every channel (including the separate 3d.feralcreative.tv printer cam), three cat cameras with an optional SKYLINE tile, and a full-window Montclair skyline viewer. All sites share the existing nginx, MediaMTX, and Express/ONVIF stack.

## Sites

| Experience | Production URL | Local URL |
| --- | --- | --- |
| Channel dashboard | <https://feralcreative.tv/> | <http://localhost:54999/> |
| Cats | <https://cats.feralcreative.tv/> | <http://cats.localhost:54999/> |
| Montclair | <https://montclair.tv/> | <http://montclair.localhost:54999/> |
| Feed admin | <https://feralcreative.tv/admin> | <http://localhost:54999/admin> |

The new feralcreative.tv hostnames are prepared locally; external DNS, Cloudflare Tunnel ingress, OAuth origins, and deployment are still pending. The old cats.feralcreative.co host 301s to cats.feralcreative.tv once deployed, and the hub links to the separate 3d.feralcreative.tv printer cam. See [domain migration](docs/architecture.md#domain-migration-still-pending) before release.

Every page, the directory included, requires Google sign-in, and the backend enforces who may watch which channel; admins edit that list in `/admin`. Signing in on one domain does not sign you in on another.

## Local development

Install the root Sass dependency and backend dependencies, copy `.env.example` to `.env`, and fill in the camera account. Never commit credentials or the generated MediaMTX configuration.

```bash
npm install
cd backend && npm install
cd ..
cp .env.example .env
# Fill in .env, then generate the MediaMTX config.
bash utils/deploy/hooks/pre-build.sh
npm start
```

`npm start` compiles SCSS, watches styles, rebuilds the three containers, and opens the dashboard. Ctrl+C stops the stack and watcher; `npm run dev:stop` removes the containers. The Tapo cameras only load from their LAN. OBS publishes to production by default, so Montclair is normally off air locally.

There is no test suite, linter, or typechecker. Validate the dashboard, both viewers, browser console, and container health locally. Production deployment always requires explicit permission.

## Source files

| File | Role |
| --- | --- |
| `index.html` | Public channel dashboard |
| `channels.js` | Production/local channel destinations and hub links |
| `cats.html` | Existing cat camera grid |
| `skyline.html` | Full-window Montclair viewer |
| `admin.html`, `admin.js` | Four-feed admin grid and switches |
| `app.js`, `obs-stream.js` | HLS playback, modal, availability/off-air behavior |
| `config.js`, `auth.js` | Shared OAuth configuration and viewer sign-in |
| `backend/` | Feed administration and ONVIF control |
| `styles/scss/main.scss` | Shared styles; imports `components/_tv-dashboard.scss` |
| `nginx.conf` | Hostname routing and same-origin stream/API proxies |
| `Dockerfile`, `docker-compose.yml` | Static assets and local stack |

Compiled CSS and generated `mediamtx.yml` must not be edited by hand or committed. The existing container names and deployment configuration are retained. Adding a future channel is described in [architecture](docs/architecture.md#adding-a-channel).

## Documentation

- [AGENTS.md](AGENTS.md)—commands, restrictions, and operating conventions.
- [Architecture](docs/architecture.md)—sites, containers, domain migration, and channel wiring.
- [API](docs/api.md)—feed administration, ONVIF, and stream endpoints.
- [Decisions](docs/decisions.md)—existing streaming and authorization choices.
- [Debugging](docs/debugging.md)—logs and known failure modes.
- [OBS setup](docs/OBS_SETUP.md)—publishing destinations and off-air behavior.
- [Deployment](docs/DEPLOYMENT.md)—authorized release process.

## License

Private and unlicensed.
