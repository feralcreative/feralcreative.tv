# ONVIF Implementation Guide

**Date:** 2026-02-12  
**Status:** ✅ Implemented

## Overview

This document describes the ONVIF camera control implementation for the Cat Cams application. ONVIF controls are restricted to advanced users only, as defined in `config.js`.

## What Was Implemented

### 1. Stream Quality Change (All Users)

- **Changed from:** High quality stream (stream1)
- **Changed to:** Low quality stream (stream2)
- **Reason:** Reduce bandwidth usage on the main page
- **Files modified:**
  - `app.js` - Updated HLS URLs to use `cam_${camera}_low`
  - `nginx.conf` - Added support for `_low` stream paths

### 2. ONVIF Camera Controls (Advanced Users Only)

#### Advanced User Access

Users with advanced features access (defined in `config.js`):

- `@feralcreative.co` (all emails in this domain)
- `ziadezzat@gmail.com`
- `rhobbs007@gmail.com`

#### Features Available

- **PTZ Controls:** Pan, Tilt, Zoom via directional buttons
- **Preset Positions:** Return camera to home position
- **Real-time Control:** Continuous movement while button is pressed

## Architecture

### Frontend Components

1. **auth.js** - Added `hasAdvancedFeatures()` method
   - Checks if user email is in `CONFIG.ADVANCED_FEATURES`
   - Supports both exact email matches and domain wildcards

2. **onvif-controls.js** - ONVIF UI controls
   - PTZ control grid (9 directional buttons)
   - Zoom in/out buttons
   - Toggle controls visibility per camera
   - Only initializes for advanced users

3. **styles/scss/components/\_onvif-controls.scss** - Styling
   - Overlay controls on video player
   - Responsive design for mobile
   - Dark theme matching app design

### Backend Service

**Location:** `backend/`

**Files:**

- `server.js` - Express server with ONVIF proxy endpoints
- `package.json` - Dependencies (express, cors, onvif)
- `Dockerfile` - Container build instructions

**Endpoints:**

- `GET /health` - Health check
- `GET /api/onvif/:camera/capabilities` - Get camera capabilities
- `POST /api/onvif/:camera/ptz/move` - Move camera (pan/tilt/zoom)
- `POST /api/onvif/:camera/ptz/stop` - Stop camera movement
- `POST /api/onvif/:camera/ptz/preset/:presetToken` - Go to preset position

**ONVIF Configuration:**

- **Protocol:** ONVIF Profile S
- **Port:** 2020
- **Service URL:** `http://{camera_ip}:2020/onvif/device_service`
- **Authentication:** Camera account credentials from `.env`

### Infrastructure

**docker-compose.yml** - Added backend service:

```yaml
backend:
  build: ./backend
  container_name: cats-backend
  ports:
    - "3001:3001"
  environment:
    - CAMERA_USER=${CAMERA_USER}
    - CAMERA_PASS=${CAMERA_PASS}
```

**nginx.conf** - Added API proxy:

```nginx
location /api/onvif/ {
  proxy_pass http://backend:3001/api/onvif/;
  # ... proxy headers
}
```

## Camera Configuration

### RTSP Streams

Each camera has two streams configured in `mediamtx.yml`:

**High Quality (stream1):**

- Path: `cam_{camera}`
- URL: `rtsp://{user}:{pass}@{ip}:554/stream1`
- Usage: Future high-quality viewing

**Low Quality (stream2):**

- Path: `cam_{camera}_low`
- URL: `rtsp://{user}:{pass}@{ip}:554/stream2`
- Usage: Main page (current implementation)

### ONVIF Endpoints

- **Port:** 2020
- **Service:** `/onvif/device_service`
- **Profile:** Profile S (video/audio streaming, PTZ, events)
- **Limitations:** No 2-way audio (Profile S limitation)

## Deployment

### Local Development

1. **Install backend dependencies:**

   ```bash
   cd backend
   npm install
   cd ..
   ```

2. **Start all services:**

   ```bash
   docker-compose up
   ```

3. **Access:**
   - Frontend: http://localhost:54999
   - Backend API: http://localhost:3001
   - MediaMTX: http://localhost:8888

### Production Deployment

1. **Build backend image:**

   ```bash
   cd backend
   docker build -t cats-backend:latest .
   cd ..
   ```

2. **Deploy:**
   ```bash
   ./utils/deploy/prod.sh
   ```

## Testing

### Test ONVIF Access

1. **Login as advanced user** (one of the emails in `ADVANCED_FEATURES`)
2. **Look for "🎮 Controls" button** on each camera
3. **Click to open PTZ controls**
4. **Test directional buttons** - camera should move
5. **Test zoom buttons** - camera should zoom in/out

### Test Regular User

1. **Login as regular user** (not in `ADVANCED_FEATURES`)
2. **Verify no "🎮 Controls" button** appears
3. **Streams should still work** (low quality)

## Troubleshooting

### ONVIF Controls Not Appearing

**Check:**

1. User email is in `CONFIG.ADVANCED_FEATURES` in `config.js`
2. Browser console for errors
3. Backend service is running: `docker ps | grep cats-backend`

### Camera Not Responding to Commands

**Check:**

1. Camera ONVIF is enabled (should be by default on Tapo cameras)
2. Camera credentials in `.env` are correct
3. Backend can reach cameras on port 2020
4. Backend logs: `docker logs cats-backend`

### Backend Connection Issues

**Check:**

1. Backend service is running
2. Nginx proxy is configured correctly
3. Network connectivity between containers
4. Firewall rules on NAS

## Security Considerations

1. **Authentication:** Frontend checks user permissions, but backend should also verify (TODO)
2. **Network:** ONVIF should only be accessible on trusted networks
3. **Credentials:** Camera credentials stored in `.env` (gitignored)
4. **HTTPS:** Use HTTPS in production to encrypt ONVIF commands

## Future Enhancements

- [ ] Add JWT verification in backend
- [ ] Add preset position management
- [ ] Add camera settings (brightness, contrast, etc.)
- [ ] Add high-quality stream toggle for advanced users
- [ ] Add recording controls
- [ ] Add motion detection configuration

## References

- [ONVIF Documentation](https://www.onvif.org/)
- [TP-Link Tapo ONVIF Guide](../How%20to%20view%20Tapo%20camera%20on%20PCNASNVR%20through%20RTSPOnvif%20Protocol.html)
- [onvif Library](https://github.com/agsh/onvif)
