// Camera configuration
const cameras = ["left", "right", "top", "other"];
const whepClients = {};
let modalHls = null;
let currentModalCamera = null;

// Initialize all cameras
async function initializeCameras() {
  console.log("Initializing cat cams...");
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
  const videoElement = document.getElementById(`video-${camera}`);
  const statusElement = document.getElementById(`status-${camera}`);
  const loadingElement = document.getElementById(`loading-${camera}`);
  const errorElement = document.getElementById(`error-${camera}`);

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
  currentModalCamera = camera;
  const modal = document.getElementById("camera-modal");
  const modalName = document.getElementById("modal-camera-name");
  const modalVideo = document.getElementById("modal-video");
  const modalStatus = document.getElementById("modal-status");
  const modalLoading = document.getElementById("modal-loading");
  const modalError = document.getElementById("modal-error");

  // Set camera name
  modalName.textContent = camera.toUpperCase();

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
  if (window.onvifControls && auth && auth.hasAdvancedFeatures()) {
    window.onvifControls.addControlsToModal(camera);
  }
}

// Load high-res stream in modal
function loadModalStream(camera) {
  const modalVideo = document.getElementById("modal-video");
  const modalStatus = document.getElementById("modal-status");
  const modalLoading = document.getElementById("modal-loading");
  const modalError = document.getElementById("modal-error");

  // Use high-quality stream (stream1)
  const streamPath = `/cam_${camera}/video1_stream.m3u8`;

  if (modalVideo.canPlayType("application/vnd.apple.mpegurl")) {
    // Native HLS support (Safari)
    modalVideo.src = streamPath;
    modalVideo.addEventListener("loadedmetadata", () => {
      modalLoading.style.display = "none";
      modalStatus.textContent = "Connected";
      modalStatus.className = "status connected";
    });
    modalVideo.addEventListener("error", () => {
      modalLoading.style.display = "none";
      modalError.style.display = "flex";
      modalStatus.textContent = "Error";
      modalStatus.className = "status error";
    });
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
  const modal = document.getElementById("camera-modal");
  const modalVideo = document.getElementById("modal-video");

  // Hide modal
  modal.style.display = "none";

  // Stop video
  modalVideo.pause();
  modalVideo.src = "";

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
