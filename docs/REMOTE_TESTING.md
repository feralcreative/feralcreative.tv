# Remote Testing Guide

How to test the cat camera application when you're not on your home network.

## Problem

The cameras are on your home network (192.168.1.201-204), so when you're away from home:
- Camera streams won't load
- ONVIF controls can't connect to cameras

## Solutions

### Option 1: Test Mode (Recommended for Development)

Enable TEST_MODE to simulate camera responses without needing real cameras.

**Setup:**

1. Edit your `.env` file:
   ```bash
   TEST_MODE=true
   ```

2. Restart the backend:
   ```bash
   npm run dev:kill
   npm run dev
   ```

**What TEST_MODE does:**
- ✅ ONVIF API endpoints return success responses
- ✅ All PTZ commands are logged to console
- ✅ No actual camera connection required
- ❌ Camera video streams still won't work (expected)

**Console output example:**
```
[ONVIF] TEST_MODE enabled - using mock cameras
[ONVIF] LEFT (MOCK) connected
[ONVIF] RIGHT (MOCK) connected
[ONVIF] TOP (MOCK) connected
[ONVIF] OTHER (MOCK) connected
[ONVIF] TEST_MODE: Moving left - x:1, y:0, zoom:0
[ONVIF] TEST_MODE: Stopping left
```

**Testing the UI:**
1. Open http://localhost:54999
2. Click "🎮 Controls" on any camera
3. Click PTZ buttons - they'll respond instantly
4. Check browser console and backend logs to see the commands

---

### Option 2: VPN to Home Network (Full Functionality)

Set up a VPN to access your home network remotely.

**Recommended VPN Solutions:**

#### Tailscale (Easiest)
- Free for personal use
- Zero configuration
- Works through NAT/firewalls
- Install on your NAS and laptop
- [Get Tailscale](https://tailscale.com/)

#### WireGuard (Fast & Modern)
- Fast, modern VPN protocol
- Requires port forwarding on router
- [WireGuard Setup Guide](https://www.wireguard.com/quickstart/)

#### OpenVPN (Traditional)
- Well-supported, mature
- More complex setup
- [OpenVPN Setup Guide](https://openvpn.net/community-resources/)

**Once VPN is set up:**
1. Connect to your home VPN
2. Your laptop is now on the home network
3. Everything works as if you were home
4. Set `TEST_MODE=false` in `.env`

---

### Option 3: Port Forwarding (Not Recommended)

**⚠️ Security Warning:** Exposing cameras to the internet is a security risk.

If you must use port forwarding:
1. Forward ports 554 (RTSP) and 2020 (ONVIF) on your router
2. Use strong camera passwords
3. Consider using a VPN instead

---

## Comparison

| Method | Video Streams | ONVIF Controls | Security | Setup Difficulty |
|--------|---------------|----------------|----------|------------------|
| **TEST_MODE** | ❌ | ✅ (simulated) | ✅ Safe | ⭐ Easy |
| **VPN** | ✅ | ✅ (real) | ✅ Safe | ⭐⭐ Medium |
| **Port Forward** | ✅ | ✅ (real) | ⚠️ Risk | ⭐⭐⭐ Hard |

---

## Recommended Workflow

**For UI/Frontend Development:**
- Use TEST_MODE
- Focus on button interactions, layout, styling
- No need for real cameras

**For Backend/ONVIF Development:**
- Use TEST_MODE for initial testing
- Use VPN for final testing with real cameras

**For Production:**
- Always use real cameras (TEST_MODE=false)
- Access via VPN when remote

---

## Troubleshooting

**TEST_MODE not working?**
1. Check `.env` file: `TEST_MODE=true`
2. Restart backend: `npm run dev:kill && npm run dev`
3. Check backend logs for `[ONVIF] TEST_MODE enabled`

**VPN connected but cameras not accessible?**
1. Verify VPN is connected: `ping 192.168.1.201`
2. Check camera is powered on
3. Verify camera IP hasn't changed

**ONVIF controls not showing?**
1. Check you're logged in as an advanced user
2. Open browser console, look for `[ONVIF]` messages
3. Verify DEV_MODE is enabled in config.js

