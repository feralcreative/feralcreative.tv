// ONVIF Camera Controls for Advanced Users
class ONVIFControls {
  constructor() {
    // Use nginx's same-origin backend proxy in every environment.
    this.apiBaseUrl = "/api";
    this.activeCamera = null;
    this.isMoving = false;
  }

  // Initialize ONVIF controls for advanced users
  init() {
    if (!auth || !auth.hasAdvancedFeatures()) {
      console.log("[ONVIF] User does not have advanced features access");
      return;
    }

    console.log("[ONVIF] Initializing controls for advanced user");
    // Don't add controls to main page - only show in modal
  }

  // Add ONVIF controls to modal
  addControlsToModal(camera) {
    const container = document.getElementById("modal-controls-container");
    container.innerHTML = ""; // Clear any existing controls

    const controlsHTML = this.createControlsHTML(camera, true);
    container.innerHTML = controlsHTML;

    // Attach event listeners
    this.attachEventListeners(camera, true);

    // Show controls by default in modal
    const controls = document.getElementById(`onvif-modal-${camera}`);
    if (controls) {
      controls.style.display = "block";
    }
  }

  // Create HTML for PTZ controls
  createControlsHTML(camera, isModal = false) {
    const id = isModal ? `onvif-modal-${camera}` : `onvif-${camera}`;
    const toggleId = isModal ? `onvif-toggle-modal-${camera}` : `onvif-toggle-${camera}`;

    return `
      <div class="onvif-controls" id="${id}" style="display: none;">
        <div class="onvif-header">
          <span class="onvif-title">Camera Controls</span>
          <button class="onvif-close" onclick="onvifControls.hideControls('${camera}', ${isModal})">×</button>
        </div>

        <div class="ptz-controls">
          <div class="ptz-grid">
            <button class="ptz-btn" data-direction="up-left" data-camera="${camera}" data-modal="${isModal}">↖</button>
            <button class="ptz-btn" data-direction="up" data-camera="${camera}" data-modal="${isModal}">↑</button>
            <button class="ptz-btn" data-direction="up-right" data-camera="${camera}" data-modal="${isModal}">↗</button>

            <button class="ptz-btn" data-direction="left" data-camera="${camera}" data-modal="${isModal}">←</button>
            <button class="ptz-btn ptz-home" data-direction="home" data-camera="${camera}" data-modal="${isModal}">⌂</button>
            <button class="ptz-btn" data-direction="right" data-camera="${camera}" data-modal="${isModal}">→</button>

            <button class="ptz-btn" data-direction="down-left" data-camera="${camera}" data-modal="${isModal}">↙</button>
            <button class="ptz-btn" data-direction="down" data-camera="${camera}" data-modal="${isModal}">↓</button>
            <button class="ptz-btn" data-direction="down-right" data-camera="${camera}" data-modal="${isModal}">↘</button>
          </div>

          <div class="zoom-controls">
            <button class="zoom-btn" data-zoom="in" data-camera="${camera}" data-modal="${isModal}">Zoom +</button>
            <button class="zoom-btn" data-zoom="out" data-camera="${camera}" data-modal="${isModal}">Zoom −</button>
          </div>
        </div>
      </div>

      <button class="onvif-toggle" id="${toggleId}" onclick="onvifControls.toggleControls('${camera}', ${isModal})">
        🎮 Controls
      </button>
    `;
  }

  // Attach event listeners to PTZ buttons
  attachEventListeners(camera, isModal = false) {
    // PTZ direction buttons - filter by modal state
    const ptzButtons = document.querySelectorAll(`[data-camera="${camera}"][data-direction][data-modal="${isModal}"]`);
    ptzButtons.forEach((btn) => {
      btn.addEventListener("mousedown", (e) => this.startMove(camera, e.target.dataset.direction));
      btn.addEventListener("mouseup", () => this.stopMove(camera));
      btn.addEventListener("mouseleave", () => this.stopMove(camera));
      btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        this.startMove(camera, e.target.dataset.direction);
      });
      btn.addEventListener("touchend", () => this.stopMove(camera));
    });

    // Zoom buttons - filter by modal state
    const zoomButtons = document.querySelectorAll(`[data-camera="${camera}"][data-zoom][data-modal="${isModal}"]`);
    zoomButtons.forEach((btn) => {
      btn.addEventListener("mousedown", (e) => this.startZoom(camera, e.target.dataset.zoom));
      btn.addEventListener("mouseup", () => this.stopMove(camera));
      btn.addEventListener("mouseleave", () => this.stopMove(camera));
    });
  }

  // Start PTZ movement
  async startMove(camera, direction) {
    if (this.isMoving) return;
    this.isMoving = true;

    const movements = {
      up: { x: 0, y: 0.5 },
      down: { x: 0, y: -0.5 },
      left: { x: -0.5, y: 0 },
      right: { x: 0.5, y: 0 },
      "up-left": { x: -0.5, y: 0.5 },
      "up-right": { x: 0.5, y: 0.5 },
      "down-left": { x: -0.5, y: -0.5 },
      "down-right": { x: 0.5, y: -0.5 },
      home: { x: 0, y: 0 },
    };

    const move = movements[direction] || { x: 0, y: 0 };

    try {
      const response = await fetch(`${this.apiBaseUrl}/onvif/${camera}/ptz/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(move),
      });

      if (!response.ok) {
        console.error("[ONVIF] Move failed:", await response.text());
      }
    } catch (error) {
      console.error("[ONVIF] Error moving camera:", error);
    }
  }

  // Start zoom
  async startZoom(camera, direction) {
    if (this.isMoving) return;
    this.isMoving = true;

    const zoom = direction === "in" ? 0.5 : -0.5;

    try {
      const response = await fetch(`${this.apiBaseUrl}/onvif/${camera}/ptz/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: 0, y: 0, zoom }),
      });

      if (!response.ok) {
        console.error("[ONVIF] Zoom failed:", await response.text());
      }
    } catch (error) {
      console.error("[ONVIF] Error zooming camera:", error);
    }
  }

  // Stop PTZ movement
  async stopMove(camera) {
    if (!this.isMoving) return;
    this.isMoving = false;

    try {
      await fetch(`${this.apiBaseUrl}/onvif/${camera}/ptz/stop`, {
        method: "POST",
      });
    } catch (error) {
      console.error("[ONVIF] Error stopping camera:", error);
    }
  }

  // Toggle controls visibility
  toggleControls(camera, isModal = false) {
    const id = isModal ? `onvif-modal-${camera}` : `onvif-${camera}`;
    const controls = document.getElementById(id);
    if (controls) {
      controls.style.display = controls.style.display === "none" ? "block" : "none";
    }
  }

  // Hide controls
  hideControls(camera, isModal = false) {
    const id = isModal ? `onvif-modal-${camera}` : `onvif-${camera}`;
    const controls = document.getElementById(id);
    if (controls) {
      controls.style.display = "none";
    }
  }
}

// Initialize ONVIF controls when auth is ready
let onvifControls;
window.addEventListener("load", () => {
  // Wait for auth to initialize
  setTimeout(() => {
    onvifControls = new ONVIFControls();
    onvifControls.init();
    // Make it globally accessible for modal
    window.onvifControls = onvifControls;
  }, 1000);
});
