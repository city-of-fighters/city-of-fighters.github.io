// Talks to OBS on this computer through its built-in remote control (obs-websocket 5, OBS → Tools → WebSocket Server Settings).
// Used by the Stream tab for cameras and the Coming Up scene. Works in the browser and in Node (for tests).
const OBS_COMING_UP = 'CoF Coming Up';
const OBS_SPLIT_CAM = 'CoF Players camera'; // helper scene: one camera filming both players, cut in halves
const OBS_CAMERA_KINDS = ['v4l2_input', 'dshow_input', 'av_capture_input_v2', 'av_capture_input', 'macos-avcapture'];
const OBS_CAMERA_DEVICE_PROP = { v4l2_input: 'device_id', dshow_input: 'video_device_id', av_capture_input_v2: 'device', av_capture_input: 'device', 'macos-avcapture': 'device' };
// The Coming Up asset's windows, in 1920×1080 pixels (measured from Cof_Coming_Up_Screen_P1.png)
const HUD_CAMS = 'CoF HUD cameras'; // scene inside the main scene: player cameras in the bottom corners during a match
const HUD_CAM_WINDOWS = { cam1: { x: 28, y: 816, w: 240, h: 135 }, cam2: { x: 1652, y: 816, w: 240, h: 135 } }; // same boxes as in overlay.html
const COMING_UP_WINDOWS = { screen: { x: 64, y: 206, w: 1192, h: 668 }, cam1: { x: 1324, y: 207, w: 532, h: 294 }, cam2: { x: 1324, y: 579, w: 532, h: 294 } };

class OBSRemote {
  constructor() { this.ws = null; this.pending = new Map(); this.n = 0; this.platform = ''; }

  async connect(url, password) {
    this.close();
    const ws = new WebSocket(url);
    this.ws = ws;
    const hello = await new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('OBS did not answer. Is OBS open, with the WebSocket server turned on?')), 5000);
      ws.onerror = () => { clearTimeout(t); fail(new Error('Could not reach OBS. Open OBS and turn on Tools → WebSocket Server Settings → Enable WebSocket server.')); };
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.op === 0) { clearTimeout(t); ok(m.d); } };
    });
    const identify = { rpcVersion: 1, eventSubscriptions: 0 };
    if (hello.authentication) {
      if (!password) throw new Error('OBS needs its WebSocket password');
      const { challenge, salt } = hello.authentication;
      identify.authentication = await sha256b64((await sha256b64(password + salt)) + challenge);
    }
    await new Promise((ok, fail) => {
      ws.onclose = e => fail(new Error(e.code === 4009 ? 'Wrong OBS WebSocket password' : `OBS closed the connection (${e.code})`));
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.op === 2) ok(); };
      ws.send(JSON.stringify({ op: 1, d: identify }));
    });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.op !== 7) return;
      const p = this.pending.get(m.d.requestId);
      if (!p) return;
      this.pending.delete(m.d.requestId);
      m.d.requestStatus.result ? p.ok(m.d.responseData ?? {}) : p.fail(new Error(m.d.requestStatus.comment || `OBS refused ${m.d.requestType}`));
    };
    ws.onclose = () => { for (const p of this.pending.values()) p.fail(new Error('Lost the connection to OBS')); this.pending.clear(); this.ws = null; };
    this.platform = (await this.call('GetVersion')).platform;
    return this;
  }

  close() { try { this.ws?.close(); } catch {} this.ws = null; }
  get connected() { return !!this.ws && this.ws.readyState === 1; }

  call(requestType, requestData = {}) {
    if (!this.connected) return Promise.reject(new Error('Not connected to OBS'));
    const requestId = String(++this.n);
    return new Promise((ok, fail) => {
      this.pending.set(requestId, { ok, fail });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  // --- cameras ---
  cameraKind() { return { windows: 'dshow_input', macos: 'av_capture_input_v2' }[this.platform] ?? 'v4l2_input'; }
  async mainScene() { return (await this.call('GetCurrentProgramScene')).currentProgramSceneName; }
  async cameras() { // every camera input in OBS, with its device list and whether it shows in the main scene
    const { inputs } = await this.call('GetInputList');
    const scene = await this.mainScene();
    const { sceneItems } = await this.call('GetSceneItemList', { sceneName: scene });
    const out = [];
    for (const i of inputs.filter(i => OBS_CAMERA_KINDS.includes(i.inputKind))) {
      const prop = OBS_CAMERA_DEVICE_PROP[i.inputKind];
      const [{ inputSettings }, devices] = await Promise.all([
        this.call('GetInputSettings', { inputName: i.inputName }),
        this.call('GetInputPropertiesListPropertyItems', { inputName: i.inputName, propertyName: prop }).then(r => r.propertyItems.filter(d => d.itemEnabled !== false), () => []),
      ]);
      const item = sceneItems.find(s => s.sourceName === i.inputName);
      out.push({ name: i.inputName, kind: i.inputKind, prop, device: inputSettings[prop] ?? '', devices, inScene: !!item, itemId: item?.sceneItemId, enabled: !!item?.sceneItemEnabled });
    }
    return { scene, cameras: out };
  }
  async addCamera() { // a new camera in the main scene, on the first device OBS finds (bottom-right corner, small)
    const scene = await this.mainScene();
    const { inputs } = await this.call('GetInputList');
    let n = 1; while (inputs.some(i => i.inputName === `CoF Camera ${n}`)) n++;
    const name = `CoF Camera ${n}`, kind = this.cameraKind();
    const { sceneItemId } = await this.call('CreateInput', { sceneName: scene, inputName: name, inputKind: kind, inputSettings: {}, sceneItemEnabled: true });
    const prop = OBS_CAMERA_DEVICE_PROP[kind];
    const devices = await this.call('GetInputPropertiesListPropertyItems', { inputName: name, propertyName: prop }).then(r => r.propertyItems.filter(d => d.itemEnabled !== false), () => []);
    // laptops often list an infrared sensor first, which gives no picture: keep the first device that does
    for (const d of devices) {
      await this.call('SetInputSettings', { inputName: name, inputSettings: { [prop]: d.itemValue } });
      let w = 0;
      for (let i = 0; i < 15 && !w; i++) { await new Promise(r => setTimeout(r, 200)); w = (await this.call('GetSceneItemTransform', { sceneName: scene, sceneItemId })).sceneItemTransform.sourceWidth; }
      if (w) break;
    }
    await this.call('SetSceneItemTransform', { sceneName: scene, sceneItemId, sceneItemTransform: { boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 480, boundsHeight: 270, positionX: 1416, positionY: 660, boundsAlignment: 0, alignment: 5 } });
    // keep the City of Fighters graphics on top of the camera
    const { sceneItems } = await this.call('GetSceneItemList', { sceneName: scene });
    const overlay = sceneItems.find(s => s.inputKind === 'browser_source');
    if (overlay) await this.call('SetSceneItemIndex', { sceneName: scene, sceneItemId, sceneItemIndex: overlay.sceneItemIndex });
    return { name, devices };
  }
  setCameraDevice(name, prop, device) { return this.call('SetInputSettings', { inputName: name, inputSettings: { [prop]: device } }); }
  async showCamera(name, on) { // in or out of the stream; gameplay and everything else keep running
    const scene = await this.mainScene();
    let { sceneItemId } = await this.call('GetSceneItemId', { sceneName: scene, sourceName: name }).catch(() => ({}));
    if (sceneItemId == null) { if (!on) return; ({ sceneItemId } = await this.call('CreateSceneItem', { sceneName: scene, sourceName: name })); }
    await this.call('SetSceneItemEnabled', { sceneName: scene, sceneItemId, sceneItemEnabled: on });
  }
  async removeCamera(name) { // OBS removes sources in the background: wait until it's gone
    await this.call('RemoveInput', { inputName: name });
    for (let i = 0; i < 20; i++) {
      const { inputs } = await this.call('GetInputList');
      if (!inputs.some(x => x.inputName === name)) return;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // --- sources for the Coming Up screen ---
  async videoSources() { // what can be the shared screen: every input except cameras, audio and browser pages
    const { inputs } = await this.call('GetInputList');
    return inputs.filter(i => !OBS_CAMERA_KINDS.includes(i.inputKind) && !/browser_source|wasapi|pulse|alsa|jack|coreaudio|text_|color_source/.test(i.inputKind)).map(i => i.inputName);
  }

  // Builds (or rebuilds) the "CoF Coming Up" scene: the shared screen in the big window, player cameras in the small ones,
  // and the City of Fighters frame on top (its windows are see-through). Also lets the stream page switch scenes by itself.
  // split = cam1 films both players side by side: its left half goes in Player 1's window, its right half in Player 2's (swap = the other way round).
  // hudCams = the same cameras also go under the player names in the match HUD.
  async buildComingUp({ screen, cam1, cam2, split, swap, hudCams, overlayUrl, mainScene }) {
    const { scenes } = await this.call('GetSceneList');
    for (const sc of [OBS_COMING_UP, HUD_CAMS]) if (!scenes.some(s => s.sceneName === sc)) await this.call('CreateScene', { sceneName: sc });
    if (split && cam1) {
      if (!scenes.some(s => s.sceneName === OBS_SPLIT_CAM)) await this.call('CreateScene', { sceneName: OBS_SPLIT_CAM });
      const { sceneItems: old } = await this.call('GetSceneItemList', { sceneName: OBS_SPLIT_CAM });
      for (const it of old) if (it.sourceName !== cam1) await this.call('RemoveSceneItem', { sceneName: OBS_SPLIT_CAM, sceneItemId: it.sceneItemId });
      const { sceneItemId } = old.find(it => it.sourceName === cam1) ?? await this.call('CreateSceneItem', { sceneName: OBS_SPLIT_CAM, sourceName: cam1 });
      await this.call('SetSceneItemTransform', { sceneName: OBS_SPLIT_CAM, sceneItemId, sceneItemTransform: // fills the 1920×1080 canvas, so each half is 960 wide
        { boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1920, boundsHeight: 1080, boundsAlignment: 0, positionX: 960, positionY: 540, alignment: 0 } });
      cam2 = cam1 = OBS_SPLIT_CAM;
    }
    const frameName = 'CoF Coming Up frame';
    const { sceneItems } = await this.call('GetSceneItemList', { sceneName: OBS_COMING_UP });
    // the frame stays: OBS deletes a source that is in no scene any more
    for (const it of sceneItems) if (it.sourceName !== frameName) await this.call('RemoveSceneItem', { sceneName: OBS_COMING_UP, sceneItemId: it.sceneItemId });
    const place = async (source, r, half, sceneName = OBS_COMING_UP) => {
      const { sceneItemId } = await this.call('CreateSceneItem', { sceneName, sourceName: source });
      await this.call('SetSceneItemTransform', { sceneName, sceneItemId, sceneItemTransform:
        { boundsType: half ? 'OBS_BOUNDS_SCALE_OUTER' : 'OBS_BOUNDS_SCALE_INNER', cropToBounds: !!half, cropLeft: half === 'right' ? 960 : 0, cropRight: half === 'left' ? 960 : 0,
          boundsWidth: r.w, boundsHeight: r.h, boundsAlignment: 0, positionX: r.x + r.w / 2, positionY: r.y + r.h / 2, alignment: 0 } });
    };
    if (screen) await place(screen, COMING_UP_WINDOWS.screen);
    const h1 = split && (swap ? 'right' : 'left'), h2 = split && (swap ? 'left' : 'right');
    if (cam1) await place(cam1, COMING_UP_WINDOWS.cam1, h1);
    if (cam2) await place(cam2, COMING_UP_WINDOWS.cam2, h2);
    // HUD cameras (after Coming Up has the cameras, so clearing this scene never leaves a camera in no scene)
    const { sceneItems: hudOld } = await this.call('GetSceneItemList', { sceneName: HUD_CAMS });
    for (const it of hudOld) await this.call('RemoveSceneItem', { sceneName: HUD_CAMS, sceneItemId: it.sceneItemId });
    const showHud = !!(hudCams && (cam1 || cam2));
    if (showHud && cam1) await place(cam1, HUD_CAM_WINDOWS.cam1, h1, HUD_CAMS);
    if (showHud && cam2) await place(cam2, HUD_CAM_WINDOWS.cam2, h2, HUD_CAMS);
    const { sceneItems: mainItems } = await this.call('GetSceneItemList', { sceneName: mainScene });
    const overlayItem = mainItems.find(it => it.inputKind === 'browser_source');
    if (!mainItems.some(it => it.sourceName === HUD_CAMS)) { // just under the stream page, so its outlines sit on top of the cameras
      const { sceneItemId } = await this.call('CreateSceneItem', { sceneName: mainScene, sourceName: HUD_CAMS });
      if (overlayItem) await this.call('SetSceneItemIndex', { sceneName: mainScene, sceneItemId, sceneItemIndex: overlayItem.sceneItemIndex });
    }
    const url = `${overlayUrl}?screen=comingup&main=${encodeURIComponent(mainScene)}&has=${[screen && 'screen', cam1 && 'cam1', cam2 && 'cam2'].filter(Boolean).join(',')}`;
    const { inputs } = await this.call('GetInputList');
    const frameSettings = { url, width: 1920, height: 1080, reroute_audio: false, shutdown: false, restart_when_active: false, webpage_control_level: 4 };
    if (inputs.some(i => i.inputName === frameName)) {
      await this.call('SetInputSettings', { inputName: frameName, inputSettings: frameSettings });
      const frame = sceneItems.find(it => it.sourceName === frameName);
      const { sceneItemId } = frame ?? await this.call('CreateSceneItem', { sceneName: OBS_COMING_UP, sourceName: frameName });
      const { sceneItems: now } = await this.call('GetSceneItemList', { sceneName: OBS_COMING_UP });
      await this.call('SetSceneItemIndex', { sceneName: OBS_COMING_UP, sceneItemId, sceneItemIndex: now.length - 1 }); // on top
    } else await this.call('CreateInput', { sceneName: OBS_COMING_UP, inputName: frameName, inputKind: 'browser_source', inputSettings: frameSettings, sceneItemEnabled: true });
    // the stream page in the main scene switches to Coming Up between matches and back when a match starts
    for (const i of inputs.filter(i => i.inputKind === 'browser_source' && i.inputName !== frameName)) {
      const { inputSettings } = await this.call('GetInputSettings', { inputName: i.inputName });
      if (!/overlay\.html/.test(inputSettings.url ?? '')) continue;
      const u = new URL(inputSettings.url);
      if (showHud) u.searchParams.set('cams', 1); else u.searchParams.delete('cams'); // the page draws the camera outlines
      await this.call('SetInputSettings', { inputName: i.inputName, inputSettings: { url: u.href, webpage_control_level: 4 } });
    }
  }
}

async function sha256b64(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let s = ''; for (const b of new Uint8Array(h)) s += String.fromCharCode(b);
  return btoa(s);
}

if (typeof module === 'object') module.exports = { OBSRemote, COMING_UP_WINDOWS, OBS_COMING_UP, OBS_SPLIT_CAM, HUD_CAMS };
