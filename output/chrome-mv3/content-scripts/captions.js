(function(){function e(e){return e}var t={deepgram_disconnected:`Deepgram 字幕連線中斷，請重新啟動`,invalid_credentials:`DeepL API Key 無效，請到設定頁更新`,invalid_response:`DeepL 回傳了無法辨識的資料`,provider_unavailable:`DeepL 服務暫時無法使用`,quota_exceeded:`DeepL 本月翻譯額度已用完`,rate_limited:`DeepL 請求過於頻繁，請稍後再試`,translation_disabled:`DeepL 連續失敗 5 次，本次字幕已停止翻譯`,translation_failed:`DeepL 翻譯失敗，英文字幕仍會繼續`};function n(e){let t=e.location.hostname,n=t.includes(`youtube.com`)?`video.html5-main-video`:t.includes(`netflix.com`)?`video`:t.includes(`disneyplus.com`)?`[data-testid="video-player"] video, video`:`video`;return Array.from(e.querySelectorAll(n))}function r(e){return n(e).map(e=>({video:e,rect:e.getBoundingClientRect()})).filter(({rect:e})=>e.width>0&&e.height>0).sort((e,t)=>t.rect.width*t.rect.height-e.rect.width*e.rect.height)[0]?.video}var i=`
  :host { all: initial; }
  .stage {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: flex-end;
    padding: 0 5% 5%;
    pointer-events: none;
    width: 100%;
  }
  .captions {
    align-self: center;
    background: rgba(3, 7, 18, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
    box-sizing: border-box;
    color: #fff;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.35;
    max-width: min(92%, 1100px);
    padding: 8px 14px;
    text-align: center;
    text-wrap: balance;
  }
  .original {
    font-size: var(--caption-original-size, 24px);
    font-weight: 650;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 2px #000;
  }
  .translation {
    color: #fde68a;
    font-size: var(--caption-translation-size, 22px);
    font-weight: 550;
    margin-top: 3px;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 2px #000;
  }
  .status-message {
    color: #fca5a5;
    font-size: 16px;
    font-weight: 600;
    margin-top: 5px;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 2px #000;
  }
  .original:empty, .translation:empty, .status-message:empty { display: none; }
  @media (prefers-reduced-motion: no-preference) {
    .captions { transition: opacity 160ms ease-out; }
  }
`,a=class{document;activeSegmentId;host;nativeCue;nativeTrack;nativeVideo;originalElement;originalTextValue=``;statusElement;statusTextValue=``;translations=new Map;translationElement;constructor(e){this.document=e}show(e){this.host||this.createHost(),this.setSizes(e),this.position()}hide(){this.disableNativeTextTrack(),this.host?.remove(),this.host=void 0,this.originalElement=void 0,this.statusElement=void 0,this.translationElement=void 0,this.activeSegmentId=void 0,this.originalTextValue=``,this.statusTextValue=``,this.translations.clear()}setSizes(e){this.host?.style.setProperty(`--caption-original-size`,`${e.originalFontSize}px`),this.host?.style.setProperty(`--caption-translation-size`,`${e.translationFontSize}px`)}setOriginal(e,t){this.activeSegmentId=e,this.originalTextValue=t,this.originalElement&&(this.originalElement.textContent=t),this.translationElement&&(this.translationElement.textContent=this.translations.get(e)??``),this.syncNativeCue()}setSessionError(e){this.statusTextValue=t[e]??`字幕服務發生未知錯誤，請重新啟動`,this.statusElement&&(this.statusElement.textContent=this.statusTextValue),this.syncNativeCue()}clearSessionError(){this.statusTextValue=``,this.statusElement&&(this.statusElement.textContent=``),this.syncNativeCue()}setTranslation(e){let t=this.translations.get(e.segmentId)??``,n=e.mode===`replace`?e.text:[t,e.text].filter(Boolean).join(` `);this.translations.set(e.segmentId,n),this.activeSegmentId??=e.segmentId,this.activeSegmentId===e.segmentId&&this.translationElement&&(this.translationElement.textContent=n),this.syncNativeCue()}translationText(){return this.translationElement?.textContent??``}position(){if(!this.host)return;let e=this.document.fullscreenElement,t=e instanceof HTMLElement&&!(e instanceof HTMLVideoElement)?e:this.document.documentElement;this.host.parentElement!==t&&t.append(this.host),e instanceof HTMLVideoElement?this.enableNativeTextTrack(e):this.disableNativeTextTrack();let n=r(this.document);if(!n){Object.assign(this.host.style,{height:`100vh`,left:`0px`,top:`0px`,width:`100vw`}),this.host.dataset.mode=`viewport`;return}let i=n.getBoundingClientRect();Object.assign(this.host.style,{height:`${i.height}px`,left:`${i.left}px`,top:`${i.top}px`,width:`${i.width}px`}),this.host.dataset.mode=`video`}createHost(){let e=this.document.createElement(`div`);e.dataset.bilingualCaptionRoot=``,Object.assign(e.style,{display:`block`,pointerEvents:`none`,position:`fixed`,zIndex:`2147483647`});let t=e.attachShadow({mode:`open`}),n=this.document.createElement(`style`);n.textContent=i;let r=this.document.createElement(`div`);r.className=`stage`;let a=this.document.createElement(`div`);a.className=`captions`,a.setAttribute(`aria-live`,`polite`),a.setAttribute(`role`,`status`);let o=this.document.createElement(`div`);o.className=`original`;let s=this.document.createElement(`div`);s.className=`translation`;let c=this.document.createElement(`div`);c.className=`status-message`,c.textContent=this.statusTextValue,a.append(o,s,c),r.append(a),t.append(n,r),this.document.documentElement.append(e),this.host=e,this.originalElement=o,this.statusElement=c,this.translationElement=s}enableNativeTextTrack(e){if(this.nativeVideo===e)return;this.disableNativeTextTrack();let t=this.document.defaultView?.VTTCue;if(!t)return;let n=e.addTextTrack(`captions`,`雙語即時字幕`);n.mode=`showing`;let r=new t(0,1e9,``);n.addCue(r),this.nativeCue=r,this.nativeTrack=n,this.nativeVideo=e,this.syncNativeCue()}disableNativeTextTrack(){if(this.nativeCue)try{this.nativeTrack?.removeCue(this.nativeCue)}catch{}this.nativeTrack&&(this.nativeTrack.mode=`disabled`),this.nativeCue=void 0,this.nativeTrack=void 0,this.nativeVideo=void 0}syncNativeCue(){if(!this.nativeCue)return;let e=this.activeSegmentId?this.translations.get(this.activeSegmentId)??``:``;this.nativeCue.text=[this.originalTextValue,e,this.statusTextValue].filter(Boolean).join(`
`)}},o=e({matches:[`https://*/*`],main(){let e=new a(document),t=!1,n=()=>{t||(t=!0,requestAnimationFrame(()=>{t=!1,e.position()}))};new MutationObserver(n).observe(document.documentElement,{childList:!0,subtree:!0}),window.addEventListener(`resize`,n),window.addEventListener(`scroll`,n,{passive:!0}),document.addEventListener(`fullscreenchange`,n),chrome.runtime.onMessage.addListener((t,n,r)=>{switch(t.type){case`CONTENT_PING`:r({ok:!0});break;case`OVERLAY_SHOW`:e.show(t.payload);break;case`OVERLAY_HIDE`:e.hide();break;case`CAPTION_ORIGINAL`:e.setOriginal(t.payload.segmentId,t.payload.text);break;case`CAPTION_TRANSLATION`:e.setTranslation(t.payload);break;case`SESSION_ERROR`:e.setSessionError(t.payload.code);break;case`SESSION_ERROR_CLEAR`:e.clearSessionError()}return!1}),chrome.runtime.sendMessage({target:`background`,type:`CONTENT_READY`})}}),s={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)},c=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome,l=class e extends Event{static EVENT_NAME=u(`wxt:locationchange`);constructor(t,n){super(e.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=n}};function u(e){return`${c?.runtime?.id}:captions:${e}`}var d=typeof globalThis.navigation?.addEventListener==`function`;function f(e){let t,n=!1;return{run(){n||(n=!0,t=new URL(location.href),d?globalThis.navigation.addEventListener(`navigate`,e=>{let n=new URL(e.destination.url);n.href!==t.href&&(window.dispatchEvent(new l(n,t)),t=n)},{signal:e.signal}):e.setInterval(()=>{let e=new URL(location.href);e.href!==t.href&&(window.dispatchEvent(new l(e,t)),t=e)},1e3))}}}var p=class e{static SCRIPT_STARTED_MESSAGE_TYPE=u(`wxt:content-script-started`);id;abortController;locationWatcher=f(this);constructor(e,t){this.contentScriptName=e,this.options=t,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(e){return this.abortController.abort(e)}get isInvalid(){return c.runtime?.id??this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(e){return this.signal.addEventListener(`abort`,e),()=>this.signal.removeEventListener(`abort`,e)}block(){return new Promise(()=>{})}setInterval(e,t){let n=setInterval(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearInterval(n)),n}setTimeout(e,t){let n=setTimeout(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearTimeout(n)),n}requestAnimationFrame(e){let t=requestAnimationFrame((...t)=>{this.isValid&&e(...t)});return this.onInvalidated(()=>cancelAnimationFrame(t)),t}requestIdleCallback(e,t){let n=requestIdleCallback((...t)=>{this.signal.aborted||e(...t)},t);return this.onInvalidated(()=>cancelIdleCallback(n)),n}addEventListener(e,t,n,r){t===`wxt:locationchange`&&this.isValid&&this.locationWatcher.run(),e.addEventListener?.(t.startsWith(`wxt:`)?u(t):t,n,{...r,signal:this.signal})}notifyInvalidated(){this.abort(`Content script context invalidated`),s.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(e.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),this.options?.noScriptStartedPostMessage||window.postMessage({type:e.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},`*`)}verifyScriptStartedEvent(e){let t=e.detail?.contentScriptName===this.contentScriptName,n=e.detail?.messageId===this.id;return t&&!n}listenForNewerScripts(){let t=e=>{!(e instanceof CustomEvent)||!this.verifyScriptStartedEvent(e)||this.notifyInvalidated()};document.addEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t),this.onInvalidated(()=>document.removeEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t))}},m={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)};return(async()=>{try{let{main:e,...t}=o;return await e(new p(`captions`,t))}catch(e){throw m.error(`The content script "captions" crashed on startup!`,e),e}})()})();