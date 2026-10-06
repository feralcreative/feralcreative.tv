# Optional OBS camera

The SKYLINE tile uses the USB camera attached to the Mac through OBS. LEFT, RIGHT, and TOP remain the Tapo cameras. SKYLINE shows an off-air slate while OBS is stopped and reconnects automatically when publishing starts. The same behavior applies to its expanded view.

## Connection

```text
USB camera → OBS (H.264/AAC) → MediaMTX (RTMP) → website (HLS)
```

OBS publishes one rendition to `cam_other`. MediaMTX copies its video track, without audio, to `cam_other_video`, which the grid and modal both read as `/cam_other/index.m3u8`; no NAS transcoding or second encode is required. This works with either 1080p or 4K output, subject to the selected capture format and available bandwidth.

## Port setup

The MediaMTX template enables its RTMP listener internally on TCP 1935. The Mac-only dev binding and NAS LAN production binding are configured. `AGENTS.md` requires human approval before further published-port changes.

Local `docker-compose.yml` (configured):

```yaml
ports:
  - "127.0.0.1:1935:1935"
```

Production `docker-compose.prod.yml` mapping (applied to the NAS on 2026-09-30):

```yaml
- "192.168.1.3:1936:1935"
```

The local binding accepts OBS on this Mac only. Production uses the NAS LAN interface on port 1936 because another NAS service already occupies port 1935. OBS now publishes directly to production; the Mac dev stack does not need to run. No router port-forward or Cloudflare change is needed. Future deployments still require explicit approval.

## OBS setup

The user has already configured OBS; preserve that setup. For a fresh setup, use a dedicated Cat Cams profile and scene collection. Add a Video Capture Device source and select the USB camera. Leave desktop and microphone audio disabled unless intentionally wanted.

Use Settings → Stream:

| Setting | Local preview | Production (current OBS destination) |
| --- | --- | --- |
| Service | Custom | Custom |
| Server | `rtmp://127.0.0.1:1935` | `rtmp://192.168.1.3:1936` |
| Stream key | `cam_other?user=<encoded username>&pass=<encoded password>` | Same format |
| Use authentication | Disabled | Disabled |

Use the existing camera account from 1Password and percent-encode each credential value in the stream key. MediaMTX authenticates RTMP through the `user` and `pass` URL query parameters; OBS's separate authentication fields do not supply this format. Disabling that checkbox does not disable authentication on the server. Keep the stream key masked.

The credentials stay in OBS and the generated MediaMTX configuration. Never put them in frontend JavaScript, an OBS profile export, or documentation. The publishing path rejects a second publisher while one is already connected.

Start with 1920×1080 at 30 fps, Apple VT H264 Hardware Encoder, a two-second keyframe interval, and approximately 6,000 Kbps. Audio is never served, so any audio OBS sends is discarded. For 4K, set both capture and output to 3840×2160 at 30 fps and measure encoder load, dropped frames, and viewer bandwidth before settling on a bitrate. Hardware encoding reduces CPU work; it does not guarantee zero load.

Click Start Streaming to go live and Stop Streaming to go off air. Leaving OBS open without streaming also shows the off-air slate. The site checks availability every four seconds; playback startup and a stalled network connection can take longer to resolve.

## Verification

1. With OBS stopped, confirm the SKYLINE tile and modal show Off the air without ONVIF controls.
2. Start Streaming and confirm actual video plays in both views.
3. Stop Streaming and confirm both views clear the old frame and return to the slate.
4. Start again without reloading the page; confirm automatic recovery.
5. Confirm LEFT, RIGHT, and TOP continue streaming and retain their controls.

Current validation and outstanding setup should be reported separately; a rendered off-air tile does not prove OBS capture, publishing, or production deployment works.

Local validation on 2026-09-30: actual OBS publishing plays in both the SKYLINE tile and expanded view. Stopping OBS returns both views to the off-air slate; restarting restores playback without reloading. The status endpoint changes from HTTP 200 with `live: true` to `live: false` and back. FFmpeg successfully decoded three frames after recovery. The existing OBS output is H.264 at 1280×720, 60 fps, with AAC audio; its video and scene settings were preserved. The three Tapo feeds continue playing. The running MediaMTX configuration confirms an authenticated publisher path with publisher replacement disabled. SCSS compilation, JavaScript syntax, nginx configuration, and simulated HLS.js/native-HLS start/stop/reconnect/cleanup checks also pass. Browser console errors previously observed are the existing manifest/favicon issues. Production validation on 2026-09-30: added the LAN-only port mapping and recreated only MediaMTX; changed the existing OBS destination to `rtmp://192.168.1.3:1936`, preserving its stream key, scenes, and video settings. The public status endpoint reports `live: true`, FFmpeg decoded three frames through the public HLS endpoint, and Chrome shows SKYLINE playing alongside all three Tapo feeds. OBS is left streaming to production.

References: [MediaMTX OBS publishing](https://mediamtx.org/docs/publish/obs-studio), [MediaMTX authentication](https://mediamtx.org/docs/features/authentication), [OBS hardware encoding](https://obsproject.com/kb/hardware-encoding).
