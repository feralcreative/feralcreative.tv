// Camera configuration
const cameras = ["left", "right", "top", "other"];
const whepClients = {};
let modalHls = null;
let modalNativeCleanup = null;
let currentModalCamera = null;
// Feed on/off state from the admin panel; a missing key means on.
let feedEnabled = {};
let feedPoll = null;

function isFeedOff(camera) {
  return feedEnabled[camera] === false;
}

// Fetch feed state; resolves to the cameras whose state changed.
async function refreshFeeds() {
  try {
    const response = await fetch("/api/feeds", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { feeds } = await response.json();
    const changed = cameras.filter((camera) => feeds[camera] && feeds[camera].enabled !== !isFeedOff(camera));
    feedEnabled = Object.fromEntries(Object.entries(feeds).map(([key, feed]) => [key, feed.enabled]));
    return changed;
  } catch (error) {
    console.error("[FEEDS] Could not load feed state:", error);
    return [];
  }
}

async function pollFeeds() {
  const changed = await refreshFeeds();
  for (const camera of changed) {
    console.log(`[FEEDS] ${camera} turned ${isFeedOff(camera) ? "off" : "on"}`);
    if (camera !== "other") await reconnect(camera);
    if (currentModalCamera === camera) loadModalStream(camera);
  }
}

function showFeedOff(camera) {
  const videoElement = document.getElementById(`video-${camera}`);
  if (whepClients[camera]) {
    whepClients[camera].destroy();
    delete whepClients[camera];
  }
  videoElement.pause();
  videoElement.removeAttribute("src");
  videoElement.load();
  document.getElementById(`loading-${camera}`).style.display = "none";
  document.getElementById(`error-${camera}`).style.display = "none";
  document.getElementById(`offair-${camera}`).hidden = false;
  const statusElement = document.getElementById(`status-${camera}`);
  statusElement.textContent = "Off air";
  statusElement.className = "status offline";
}

// Initialize all cameras
async function initializeCameras() {
  console.log("Initializing cat cams...");
  const adminLink = document.getElementById("admin-link");
  if (adminLink && auth && auth.hasAdvancedFeatures()) adminLink.hidden = false;
  await refreshFeeds();
  if (!feedPoll) feedPoll = setInterval(pollFeeds, 15000);
  for (const camera of cameras) {
    await connectCamera(camera);
    // Make camera containers clickable
    addCameraClickHandler(camera);
  }
}

// Add click handler to camera container to open modal
function addCameraClickHandler(camera) {
  const container = document.querySelector(`#video-${camera}`).parentElement.parentElement;
  container.style.cursor = "pointer";
  container.addEventListener("click", (e) => {
    // Don't open modal if clicking on controls button
    if (e.target.closest(".onvif-toggle") || e.target.closest(".onvif-controls")) {
      return;
    }
    openModal(camera);
  });
}

// Connect to a single camera using HLS
async function connectCamera(camera) {
  if (camera === "other") {
    obsStream.attach("grid");
    return;
  }
  const videoElement = document.getElementById(`video-${camera}`);
  const statusElement = document.getElementById(`status-${camera}`);
  const loadingElement = document.getElementById(`loading-${camera}`);
  const errorElement = document.getElementById(`error-${camera}`);

  if (isFeedOff(camera)) {
    showFeedOff(camera);
    return;
  }
  document.getElementById(`offair-${camera}`).hidden = true;

  try {
    // Show loading state
    loadingElement.style.display = "flex";
    errorElement.style.display = "none";
    statusElement.textContent = "Connecting...";
    statusElement.className = "status connecting";

    // Use HLS streaming
    await tryHLSFallback(camera);
  } catch (error) {
    console.error(`[${camera}] Connection error:`, error);
    statusElement.textContent = "Error";
    statusElement.className = "status error";
    loadingElement.style.display = "none";
    errorElement.style.display = "flex";
  }
}

// Use HLS streaming with automatic retry logic
async function tryHLSFallback(camera, retryCount = 0, maxRetries = 3) {
  // A retry scheduled before the feed was switched off must not reconnect it.
  if (isFeedOff(camera)) return;
  const videoElement = document.getElementById(`video-${camera}`);
  const statusElement = document.getElementById(`status-${camera}`);
  const loadingElement = document.getElementById(`loading-${camera}`);
  const errorElement = document.getElementById(`error-${camera}`);

  console.log(`[${camera}] Starting HLS stream... (attempt ${retryCount + 1}/${maxRetries + 1})`);

  if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
    // Native HLS support (Safari) - using low quality stream (stream2)
    videoElement.src = `/cam_${camera}_low/video1_stream.m3u8`;

    const handleError = () => {
      if (retryCount < maxRetries) {
        console.log(`[${camera}] Native HLS error, retrying in ${(retryCount + 1)}s... (${retryCount + 1}/${maxRetries})`);
        setTimeout(() => {
          tryHLSFallback(camera, retryCount + 1, maxRetries);
        }, 1000 * (retryCount + 1)); // Exponential backoff: 1s, 2s, 3s
      } else {
        console.error(`[${camera}] Native HLS failed after ${maxRetries} retries`);
        loadingElement.style.display = "none";
        errorElement.style.display = "flex";
        statusElement.textContent = "Error";
        statusElement.className = "status error";
      }
    };

    videoElement.addEventListener("loadedmetadata", () => {
      loadingElement.style.display = "none";
      statusElement.textContent = "Connected";
      statusElement.className = "status connected";
    }, { once: true });

    videoElement.addEventListener("error", handleError, { once: true });
    videoElement.play();
  } else if (typeof Hls !== "undefined") {
    // Use hls.js for other browsers
    const hls = new Hls({
      maxLiveSyncPlaybackRate: 1.5,
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      loadingElement.style.display = "none";
      statusElement.textContent = "Connected";
      statusElement.className = "status connected";
      videoElement.play();
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        if (retryCount < maxRetries) {
          console.log(`[${camera}] HLS.js error (${data.type}), retrying in ${(retryCount + 1)}s... (${retryCount + 1}/${maxRetries})`);
          hls.destroy();
          setTimeout(() => {
            tryHLSFallback(camera, retryCount + 1, maxRetries);
          }, 1000 * (retryCount + 1)); // Exponential backoff: 1s, 2s, 3s
        } else {
          console.error(`[${camera}] HLS.js failed after ${maxRetries} retries:`, data);
          loadingElement.style.display = "none";
          errorElement.style.display = "flex";
          statusElement.textContent = "Error";
          statusElement.className = "status error";
        }
      }
    });

    // Load low quality stream (stream2)
    hls.loadSource(`/cam_${camera}_low/video1_stream.m3u8`);
    hls.attachMedia(videoElement);

    // Store HLS instance for cleanup
    whepClients[camera] = hls;
  } else {
    console.error(`[${camera}] HLS not supported`);
    loadingElement.style.display = "none";
    errorElement.style.display = "flex";
    statusElement.textContent = "Error";
    statusElement.className = "status error";
  }
}

// Reconnect a camera
async function reconnect(camera) {
  if (camera === "other") {
    obsStream.check();
    return;
  }
  console.log(`[${camera}] Reconnecting...`);

  // Close existing connection
  if (whepClients[camera]) {
    if (typeof whepClients[camera].destroy === "function") {
      // HLS.js instance
      whepClients[camera].destroy();
    } else if (typeof whepClients[camera].close === "function") {
      // RTCPeerConnection instance
      whepClients[camera].close();
    }
    delete whepClients[camera];
  }

  // Reconnect
  await connectCamera(camera);
}

// Open modal with high-res stream
function openModal(camera) {
  closeModal();
  currentModalCamera = camera;
  const modal = document.getElementById("camera-modal");
  const modalName = document.getElementById("modal-camera-name");
  const modalVideo = document.getElementById("modal-video");
  const modalStatus = document.getElementById("modal-status");
  const modalLoading = document.getElementById("modal-loading");
  const modalError = document.getElementById("modal-error");

  // Set camera name
  modalName.textContent = camera === "other" ? "SKYLINE" : camera.toUpperCase();

  // Show modal
  modal.style.display = "flex";

  // Reset state
  modalStatus.textContent = "Connecting...";
  modalStatus.className = "status connecting";
  modalLoading.style.display = "flex";
  modalError.style.display = "none";

  // Load high-res stream (stream1)
  loadModalStream(camera);

  // Initialize ONVIF controls in modal if user has access
  if (camera !== "other" && window.onvifControls && auth && auth.hasAdvancedFeatures()) {
    window.onvifControls.addControlsToModal(camera);
  }
}

// Load high-res stream in modal
function loadModalStream(camera) {
  if (modalNativeCleanup) modalNativeCleanup();
  modalNativeCleanup = null;
  if (camera === "other") {
    obsStream.attach("modal");
    return;
  }
  const modalVideo = document.getElementById("modal-video");
  const modalStatus = document.getElementById("modal-status");
  const modalLoading = document.getElementById("modal-loading");
  const modalError = document.getElementById("modal-error");
  const modalOffAir = document.getElementById("modal-offair");

  if (modalHls) {
    modalHls.destroy();
    modalHls = null;
  }
  modalOffAir.hidden = !isFeedOff(camera);
  if (isFeedOff(camera)) {
    modalVideo.pause();
    modalVideo.removeAttribute("src");
    modalLoading.style.display = "none";
    modalError.style.display = "none";
    modalStatus.textContent = "Off air";
    modalStatus.className = "status offline";
    return;
  }
  modalStatus.textContent = "Connecting...";
  modalStatus.className = "status connecting";
  modalLoading.style.display = "flex";
  modalError.style.display = "none";

  // Use high-quality stream (stream1)
  const streamPath = `/cam_${camera}/video1_stream.m3u8`;

  if (modalVideo.canPlayType("application/vnd.apple.mpegurl")) {
    // Native HLS support (Safari)
    modalVideo.src = streamPath;
    const connected = () => {
      modalLoading.style.display = "none";
      modalStatus.textContent = "Connected";
      modalStatus.className = "status connected";
    };
    const failed = () => {
      modalLoading.style.display = "none";
      modalError.style.display = "flex";
      modalStatus.textContent = "Error";
      modalStatus.className = "status error";
    };
    modalVideo.addEventListener("loadedmetadata", connected);
    modalVideo.addEventListener("error", failed);
    modalNativeCleanup = () => {
      modalVideo.removeEventListener("loadedmetadata", connected);
      modalVideo.removeEventListener("error", failed);
    };
    modalVideo.play();
  } else if (typeof Hls !== "undefined") {
    // Use hls.js for other browsers
    if (modalHls) {
      modalHls.destroy();
    }

    modalHls = new Hls({
      maxLiveSyncPlaybackRate: 1.5,
    });

    modalHls.on(Hls.Events.MANIFEST_PARSED, () => {
      modalLoading.style.display = "none";
      modalStatus.textContent = "Connected";
      modalStatus.className = "status connected";
      modalVideo.play();
    });

    modalHls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error(`[modal-${camera}] HLS error:`, data);
        modalLoading.style.display = "none";
        modalError.style.display = "flex";
        modalStatus.textContent = "Error";
        modalStatus.className = "status error";
      }
    });

    modalHls.loadSource(streamPath);
    modalHls.attachMedia(modalVideo);
  }
}

// Close modal
function closeModal() {
  if (modalNativeCleanup) modalNativeCleanup();
  modalNativeCleanup = null;
  obsStream.detach("modal");
  const modal = document.getElementById("camera-modal");
  const modalVideo = document.getElementById("modal-video");

  // Hide modal
  modal.style.display = "none";

  // Stop video
  modalVideo.pause();
  modalVideo.removeAttribute("src");

  // Destroy HLS instance
  if (modalHls) {
    modalHls.destroy();
    modalHls = null;
  }

  // Clear controls
  const controlsContainer = document.getElementById("modal-controls-container");
  controlsContainer.innerHTML = "";

  currentModalCamera = null;
}

// Reconnect modal stream
function reconnectModal() {
  if (currentModalCamera) {
    loadModalStream(currentModalCamera);
  }
}

// Note: Camera initialization is now handled by auth.js
// Cameras will only initialize after successful authentication

// Reconnect on visibility change (when tab becomes visible again)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    console.log("Page visible again, checking connections...");
    cameras.forEach((camera) => {
      const pc = whepClients[camera];
      if (!pc || pc.connectionState !== "connected") {
        reconnect(camera);
      }
    });
  }
});
