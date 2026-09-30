// The optional OBS feed shares one availability check across the grid and modal.
class OBSStream {
  constructor() {
    this.views = new Map();
    this.live = false;
    this.started = false;
    this.checking = false;
    this.timer = null;
  }

  attach(name) {
    this.detach(name);
    const modal = name === "modal";
    const view = {
      video: document.getElementById(modal ? "modal-video" : "video-other"),
      status: document.getElementById(modal ? "modal-status" : "status-other"),
      loading: document.getElementById(modal ? "modal-loading" : "loading-other"),
      error: document.getElementById(modal ? "modal-error" : "error-other"),
      slate: document.getElementById(modal ? "modal-offair" : "offair-other"),
      player: null,
      cleanup: null,
      active: false,
      generation: 0,
      lastProgress: 0,
    };
    this.views.set(name, view);
    this.showOffAir(view);
    if (this.live) this.connect(view);
    if (!this.started) {
      this.started = true;
      this.check();
    }
  }

  detach(name) {
    const view = this.views.get(name);
    if (!view) return;
    this.disconnect(view);
    view.slate.hidden = true;
    this.views.delete(name);
  }

  showOffAir(view) {
    view.status.textContent = "Off air";
    view.status.className = "status offline";
    view.loading.style.display = "none";
    view.error.style.display = "none";
    view.slate.hidden = false;
  }

  disconnect(view) {
    view.active = false;
    view.generation += 1;
    if (view.cleanup) view.cleanup();
    view.cleanup = null;
    if (view.player) view.player.destroy();
    view.player = null;
    view.video.pause();
    view.video.removeAttribute("src");
    view.video.load();
  }

  connect(view) {
    if (view.active) return;
    view.active = true;
    const generation = ++view.generation;
    view.lastProgress = Date.now();
    view.status.textContent = "Connecting...";
    view.status.className = "status connecting";
    const video = view.video;
    const ready = () => {
      if (!view.active || view.generation !== generation) return;
      view.lastProgress = Date.now();
      view.slate.hidden = true;
      view.loading.style.display = "none";
      view.status.textContent = "Connected";
      view.status.className = "status connected";
    };
    const progress = () => { view.lastProgress = Date.now(); };
    const failed = () => {
      if (!view.active || view.generation !== generation) return;
      this.disconnect(view);
      this.showOffAir(view);
    };
    const play = () => { video.play().catch(failed); };
    video.addEventListener("playing", ready);
    video.addEventListener("timeupdate", progress);
    video.addEventListener("error", failed);
    video.addEventListener("ended", failed);
    video.addEventListener("loadedmetadata", play);
    view.cleanup = () => {
      video.removeEventListener("playing", ready);
      video.removeEventListener("timeupdate", progress);
      video.removeEventListener("error", failed);
      video.removeEventListener("ended", failed);
      video.removeEventListener("loadedmetadata", play);
    };

    // OBS publishes one rendition; both views use it without NAS transcoding.
    const url = "/cam_other/index.m3u8";
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    } else if (typeof Hls !== "undefined" && Hls.isSupported()) {
      const player = new Hls({ maxLiveSyncPlaybackRate: 1.5 });
      view.player = player;
      player.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) failed();
      });
      player.loadSource(url);
      player.attachMedia(video);
    } else {
      failed();
    }
  }

  async check() {
    if (!this.started || this.checking) return;
    clearTimeout(this.timer);
    this.checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch("/api/streams/other/status", {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = response.ok ? await response.json() : null;
      this.live = data && data.live === true;
    } catch (error) {
      this.live = false;
    } finally {
      clearTimeout(timeout);
      this.checking = false;
    }

    for (const view of this.views.values()) {
      if (!this.live) {
        if (view.active) this.disconnect(view);
        this.showOffAir(view);
      } else if (view.active && Date.now() - view.lastProgress > 15000) {
        // Clear a stalled/frozen picture and retry on the next availability check.
        this.disconnect(view);
        this.showOffAir(view);
      } else if (!view.active) {
        this.connect(view);
      }
    }
    this.timer = setTimeout(() => this.check(), 4000);
  }
}

const obsStream = new OBSStream();
