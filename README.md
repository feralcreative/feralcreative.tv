# Cat Cams - cats.feralcreative.co

Live streaming web application displaying three TP-Link Tapo C211 cat cameras and an optional SKYLINE camera published through OBS.

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Streaming:** HLS (low-latency), via `hls.js` or native Safari HLS
- **Media Server:** mediamtx (RTSP/RTMP to HLS converter)
- **Web Server:** nginx
- **Deployment:** Docker Compose on Synology NAS

## Quick Start

### Install Dependencies

```bash
npm install
```

### Local Development

The whole stack runs in Docker. There is no standalone JS dev server.

```bash
# Set up environment
cp .env.example .env
# Edit .env with camera credentials

# Generate mediamtx.yml from the template
bash utils/deploy/hooks/pre-build.sh

# Compile SCSS, watch for changes, start containers, and open the browser
npm start

# Stop containers
npm run dev:stop
```

The Tapo cameras are on the home LAN, so their streams only load from that network. Set `TEST_MODE=true` in `.env` to mock the PTZ controls when working remotely.

### Deployment

Deploy to production:

```bash
./utils/deploy/prod.sh
```

## Project Structure

```text
cats.feralcreative.co/
├── index.html              # Main HTML file
├── app.js                  # HLS stream client and modal
├── obs-stream.js           # Optional SKYLINE stream and off-air behavior
├── auth.js                 # Google Sign-In and access gating
├── config.js               # OAuth client ID and email allowlists
├── onvif-controls.js       # PTZ control UI
├── backend/                # Express + ONVIF PTZ proxy
├── styles/
│   ├── scss/              # SCSS source files
│   └── css/               # Compiled CSS (gitignored)
├── images/                # Static images
├── mediamtx.yml.template  # MediaMTX config template (source of truth)
├── mediamtx.yml           # Generated, gitignored, holds credentials
├── nginx.conf             # Nginx configuration
├── docker-compose.yml     # Local container orchestration
├── docker-compose.prod.yml # Production container orchestration
├── Dockerfile             # Nginx container build
└── utils/deploy/          # Deployment scripts
```

## Camera Configuration

4 TP-Link Tapo C211 cameras on static IPs:

| Camera | Name  | IP Address    |
| ------ | ----- | ------------- |
| 1      | LEFT  | 192.168.1.201 |
| 2      | RIGHT | 192.168.1.202 |
| 3      | TOP   | 192.168.1.203 |
| 4      | OTHER | 192.168.1.204 |

## Future Roadmap

- Google Auth whitelist for access
- ONVIF Controls for Advanced Features whitelist users

## Documentation

- **[AGENTS.md](AGENTS.md)** - Operating manual: commands, prohibitions, gotchas
- **[docs/architecture.md](docs/architecture.md)** - Containers, ports, stream paths
- **[docs/decisions.md](docs/decisions.md)** - Why the stack looks like this
- **[docs/debugging.md](docs/debugging.md)** - Logs, health checks, failure modes
- **[docs/OBS_SETUP.md](docs/OBS_SETUP.md)** - SKYLINE publishing, production destination, and off-air behavior
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** - Deployment guide
- **[utils/deploy/QUICK_REFERENCE.md](utils/deploy/QUICK_REFERENCE.md)** - Deployment command reference

## License

Private and unlicensed (`"license": "UNLICENSED"` in `package.json`). There is no LICENSE file.
