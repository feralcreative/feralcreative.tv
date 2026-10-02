const express = require("express");
const cors = require("cors");
const { Cam } = require("onvif");
const access = require("./access");
const feeds = require("./feeds");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// Test mode - simulates camera responses without real cameras
const TEST_MODE = process.env.TEST_MODE === "true";

// Middleware
app.use(cors());
app.use(express.json());

// Camera configuration
const CAMERAS = {
  left: { ip: "192.168.1.201", name: "LEFT" },
  right: { ip: "192.168.1.203", name: "RIGHT" },
  top: { ip: "192.168.1.202", name: "TOP" },
};

// ONVIF credentials from environment
const CAMERA_USER = process.env.CAMERA_USER || "admin";
const CAMERA_PASS = process.env.CAMERA_PASS || "password";

// Store ONVIF device instances
const devices = {};

// Initialize ONVIF devices
async function initializeDevices() {
  if (TEST_MODE) {
    console.log("[ONVIF] TEST_MODE enabled - using mock cameras");
    // In test mode, mark all cameras as "connected" (mock)
    Object.keys(CAMERAS).forEach((key) => {
      devices[key] = "mock"; // Just a placeholder to indicate camera is "available"
      console.log(`[ONVIF] ${CAMERAS[key].name} (MOCK) connected`);
    });
    return;
  }

  console.log("[ONVIF] Initializing camera connections...");

  for (const [key, camera] of Object.entries(CAMERAS)) {
    try {
      const cam = new Cam(
        {
          hostname: camera.ip,
          username: CAMERA_USER,
          password: CAMERA_PASS,
          port: 2020,
        },
        (err) => {
          if (err) {
            console.error(`[ONVIF] Failed to connect to ${camera.name} (${camera.ip}):`, err.message);
          } else {
            devices[key] = cam;
            console.log(`[ONVIF] ${camera.name} (${camera.ip}) connected`);
          }
        },
      );
    } catch (error) {
      console.error(`[ONVIF] Failed to initialize ${camera.name} (${camera.ip}):`, error.message);
    }
  }
}

// PTZ is for admins only; nginx also checks this before proxying /api/onvif/.
const requireAdvancedFeatures = access.requireAdmin;

// Sessions, the access list, and nginx's auth check
access.register(app);

// Feed on/off state (public) and admin toggles
feeds.register(app);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", cameras: Object.keys(devices) });
});

// Report only OBS availability, without exposing the MediaMTX control API.
app.get("/api/streams/other/status", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const response = await fetch("http://mediamtx:8888/cam_other/index.m3u8", {
      signal: AbortSignal.timeout(2500),
    });
    if (response.status === 404) return res.json({ live: false });
    if (!response.ok) return res.status(503).json({ live: false });
    const playlist = await response.text();
    res.json({ live: playlist.startsWith("#EXTM3U") });
  } catch (error) {
    res.status(503).json({ live: false });
  }
});

// Get camera capabilities
app.get("/api/onvif/:camera/capabilities", requireAdvancedFeatures, (req, res) => {
  const { camera } = req.params;
  const device = devices[camera];

  if (!device) {
    return res.status(404).json({ error: "Camera not found or not connected" });
  }

  try {
    // Return camera capabilities (already loaded during connect)
    res.json({
      capabilities: device.capabilities,
      profiles: device.profiles,
      videoSources: device.videoSources,
    });
  } catch (error) {
    console.error(`[ONVIF] Error getting capabilities for ${camera}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// PTZ: Move camera (continuous move)
app.post("/api/onvif/:camera/ptz/move", requireAdvancedFeatures, (req, res) => {
  const { camera } = req.params;
  const { x, y, zoom } = req.body; // x, y, zoom are values between -1 and 1
  const device = devices[camera];

  if (!device) {
    return res.status(404).json({ error: "Camera not found or not connected" });
  }

  // Test mode - simulate success
  if (TEST_MODE) {
    console.log(`[ONVIF] TEST_MODE: Moving ${camera} - x:${x}, y:${y}, zoom:${zoom}`);
    return res.json({ success: true, test: true });
  }

  try {
    device.continuousMove(
      {
        x: x || 0,
        y: y || 0,
        zoom: zoom || 0,
      },
      (err) => {
        if (err) {
          console.error(`[ONVIF] Error moving ${camera}:`, err.message);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
      },
    );
  } catch (error) {
    console.error(`[ONVIF] Error moving ${camera}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// PTZ: Stop camera movement
app.post("/api/onvif/:camera/ptz/stop", requireAdvancedFeatures, (req, res) => {
  const { camera } = req.params;
  const device = devices[camera];

  if (!device) {
    return res.status(404).json({ error: "Camera not found or not connected" });
  }

  // Test mode - simulate success
  if (TEST_MODE) {
    console.log(`[ONVIF] TEST_MODE: Stopping ${camera}`);
    return res.json({ success: true, test: true });
  }

  try {
    device.stop(
      {
        panTilt: true,
        zoom: true,
      },
      (err) => {
        if (err) {
          console.error(`[ONVIF] Error stopping ${camera}:`, err.message);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
      },
    );
  } catch (error) {
    console.error(`[ONVIF] Error stopping ${camera}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// PTZ: Go to preset position
app.post("/api/onvif/:camera/ptz/preset/:presetToken", requireAdvancedFeatures, (req, res) => {
  const { camera, presetToken } = req.params;
  const device = devices[camera];

  if (!device) {
    return res.status(404).json({ error: "Camera not found or not connected" });
  }

  // Test mode - simulate success
  if (TEST_MODE) {
    console.log(`[ONVIF] TEST_MODE: Going to preset ${presetToken} for ${camera}`);
    return res.json({ success: true, test: true });
  }

  try {
    device.gotoPreset(
      {
        preset: presetToken,
      },
      (err) => {
        if (err) {
          console.error(`[ONVIF] Error going to preset for ${camera}:`, err.message);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
      },
    );
  } catch (error) {
    console.error(`[ONVIF] Error going to preset for ${camera}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`[ONVIF Backend] Server running on port ${PORT}`);
  await initializeDevices();
});
