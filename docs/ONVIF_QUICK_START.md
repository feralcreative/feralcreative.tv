# ONVIF Quick Start Guide

## What Changed

### 1. Stream Quality (All Users)

✅ **Main page now uses low-quality streams (stream2)** to reduce bandwidth

### 2. ONVIF Camera Controls (Advanced Users Only)

✅ **PTZ controls available for:**

- `@feralcreative.co` (all emails)
- `ziadezzat@gmail.com`
- `rhobbs007@gmail.com`

## How to Use ONVIF Controls

### For Advanced Users

1. **Login** with your authorized email
2. **Look for the "🎮 Controls" button** in the bottom-right of each camera
3. **Click to open** the PTZ control panel
4. **Use directional arrows** to pan/tilt the camera
5. **Use Zoom +/−** buttons to zoom in/out
6. **Press and hold** buttons for continuous movement
7. **Release** to stop movement

### Control Panel Layout

```
↖  ↑  ↗
←  ⌂  →    (⌂ = Home position)
↙  ↓  ↘

[Zoom +] [Zoom −]
```

## Local Development Setup

### 1. Install Backend Dependencies

```bash
cd backend
npm install
cd ..
```

### 2. Ensure .env is Configured

```bash
# Copy example if needed
cp .env.example .env

# Edit .env and set:
CAMERA_USER=your_camera_username
CAMERA_PASS=your_camera_password

# Optional: Enable test mode if not on home network
TEST_MODE=true  # Set to 'false' when on home network
```

### 3. Start Services

```bash
# Start all services (mediamtx, backend, web)
npm run dev

# Or use docker-compose directly
docker-compose up
```

### 4. Stop Services

```bash
# Graceful shutdown
npm run dev:stop

# Force kill all services
npm run dev:kill
```

### 5. Access Application

- **Frontend:** http://localhost:54999
- **Backend API:** http://localhost:3001
- **Backend Health:** http://localhost:3001/health

## Production Deployment

### Build Backend Image

```bash
cd backend
docker build -t cats-backend:latest .
cd ..
```

### Deploy to NAS

```bash
./utils/deploy/prod.sh
```

The deployment script will:

1. Build the main web container
2. Transfer both images to NAS
3. Start all services (mediamtx, backend, web)
4. Verify health

## Testing Away from Home Network

If you're not on your home network, the cameras won't be accessible. You have two options:

1. **Enable TEST_MODE** (recommended for development)
   - Set `TEST_MODE=true` in `.env`
   - ONVIF controls will work but simulate responses
   - See [REMOTE_TESTING.md](REMOTE_TESTING.md) for details

2. **Use VPN** (for full functionality)
   - Connect to your home network via VPN
   - Everything works as if you were home
   - See [REMOTE_TESTING.md](REMOTE_TESTING.md) for VPN setup

## Troubleshooting

### "Controls button not showing"

- Verify you're logged in with an advanced user email
- Check browser console for errors
- Ensure `config.js` has your email in `ADVANCED_FEATURES`

### "Camera not responding to controls"

- Check backend is running: `docker ps | grep cats-backend`
- Check backend logs: `docker logs cats-backend`
- Verify camera credentials in `.env`
- Ensure cameras are reachable on port 2020

### "Backend connection error"

- Verify backend service is running
- Check nginx proxy configuration
- Test backend directly: `curl http://localhost:3001/health`

## Files Modified

### Frontend

- ✅ `app.js` - Changed to stream2 (low quality)
- ✅ `auth.js` - Added `hasAdvancedFeatures()` method
- ✅ `onvif-controls.js` - NEW: ONVIF UI controls
- ✅ `index.html` - Added onvif-controls.js script
- ✅ `styles/scss/components/_onvif-controls.scss` - NEW: Control styles
- ✅ `styles/scss/main.scss` - Import ONVIF styles

### Backend

- ✅ `backend/server.js` - NEW: ONVIF proxy server
- ✅ `backend/package.json` - NEW: Dependencies
- ✅ `backend/Dockerfile` - NEW: Container build

### Infrastructure

- ✅ `docker-compose.yml` - Added backend service
- ✅ `docker-compose.prod.yml` - Added backend service
- ✅ `nginx.conf` - Added /api/onvif/ proxy

### Documentation

- ✅ `docs/ONVIF_IMPLEMENTATION.md` - Full implementation guide
- ✅ `docs/ONVIF_QUICK_START.md` - This file

## Next Steps

1. **Test locally** with `docker-compose up`
2. **Verify stream quality** is lower (less bandwidth)
3. **Test ONVIF controls** as advanced user
4. **Deploy to production** when ready
5. **Monitor backend logs** for any issues

## Support

For detailed implementation information, see:

- [ONVIF Implementation Guide](./ONVIF_IMPLEMENTATION.md)
- [Tapo ONVIF Documentation](./How%20to%20view%20Tapo%20camera%20on%20PCNASNVR%20through%20RTSPOnvif%20Protocol.html)
