(function(){function e(e){return e}function t(){return globalThis.chrome?.i18n}function n(e,...n){return t()?.getMessage(e,n)||e}var r={backgroundOpacity:{max:100,min:0},bottomOffset:{max:60,min:0},captionRows:{max:3,min:1},captionWidth:{max:100,min:20},maxLineWidth:{max:140,min:40},minLineWidth:{max:120,min:0},originalFontSize:{max:48,min:16},translationFontSize:{max:48,min:16}},i={backgroundOpacity:50,bottomOffset:1,captionRows:2,captionWidth:70,deepgramApiKey:``,deeplApiKey:``,geminiApiKey:``,geminiTargetLanguage:`zh-Hant`,maxLineWidth:90,minLineWidth:40,originalFontSize:24,sourceLanguage:`EN`,sourceLocale:`en-US`,targetLanguage:`ZH-HANT`,transcriber:`gemini`,translationFontSize:22},a=[`deepgram`,`gemini`];function o(e,t){return typeof e==`string`?e:t}function s(e){return a.includes(e)?e:i.transcriber}function c(e,t,n){let r=typeof e==`number`&&Number.isFinite(e)?e:n;return Math.min(t.max,Math.max(t.min,Math.round(r)))}function l(e){let t=c(e.maxLineWidth,r.maxLineWidth,i.maxLineWidth);return{backgroundOpacity:c(e.backgroundOpacity,r.backgroundOpacity,i.backgroundOpacity),bottomOffset:c(e.bottomOffset,r.bottomOffset,i.bottomOffset),captionRows:c(e.captionRows,r.captionRows,i.captionRows),captionWidth:c(e.captionWidth,r.captionWidth,i.captionWidth),deepgramApiKey:o(e.deepgramApiKey,i.deepgramApiKey),deeplApiKey:o(e.deeplApiKey,i.deeplApiKey),geminiApiKey:o(e.geminiApiKey,i.geminiApiKey),geminiTargetLanguage:o(e.geminiTargetLanguage,i.geminiTargetLanguage),maxLineWidth:t,minLineWidth:Math.min(t,c(e.minLineWidth,r.minLineWidth,i.minLineWidth)),originalFontSize:c(e.originalFontSize,r.originalFontSize,i.originalFontSize),sourceLanguage:o(e.sourceLanguage,i.sourceLanguage),sourceLocale:o(e.sourceLocale,i.sourceLocale),targetLanguage:o(e.targetLanguage,i.targetLanguage),transcriber:s(e.transcriber),translationFontSize:c(e.translationFontSize,r.translationFontSize,i.translationFontSize)}}var u={deepgram_disconnected:`errorDeepgramDisconnected`,gemini_disconnected:`errorGeminiDisconnected`,gemini_invalid_credentials:`errorGeminiInvalidCredentials`,gemini_quota_exceeded:`errorGeminiQuotaExceeded`,gemini_unavailable:`errorGeminiUnavailable`,invalid_credentials:`errorInvalidCredentials`,invalid_response:`errorInvalidResponse`,provider_unavailable:`errorProviderUnavailable`,quota_exceeded:`errorQuotaExceeded`,rate_limited:`errorRateLimited`,translation_disabled:`errorTranslationDisabled`,translation_failed:`errorTranslationFailed`};function d(e){let t=e.location.hostname,n=t.includes(`youtube.com`)?`video.html5-main-video`:t.includes(`netflix.com`)?`video`:t.includes(`disneyplus.com`)?`[data-testid="video-player"] video, video`:`video`;return Array.from(e.querySelectorAll(n))}function f(e){return d(e).map(e=>({video:e,rect:e.getBoundingClientRect()})).filter(({rect:e})=>e.width>0&&e.height>0).sort((e,t)=>t.rect.width*t.rect.height-e.rect.width*e.rect.height)[0]?.video}var p=`
  :host { all: initial; }
  .stage {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: flex-end;
    padding: 0 5% var(--caption-bottom-offset, 8%);
    pointer-events: none;
    width: 100%;
  }
  .captions {
    /* Declared rather than written inline because the clamped viewport height
       is computed from these three; a divergence would size the box to a row
       height the rows do not actually have. */
    --caption-line-height: 1.35;
    --caption-pair-padding: 2px;
    --caption-translation-gap: 3px;
    align-self: center;
    background: rgba(3, 7, 18, var(--caption-bg-opacity, 0.78));
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
    box-sizing: border-box;
    color: #fff;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: var(--caption-line-height);
    /* Sized from its own setting rather than its content, so the box stops
       resizing on every caption. A share of the video width keeps it
       independent of the font size and of how many characters a line holds. */
    box-sizing: border-box;
    padding: 8px 14px;
    text-align: center;
    width: var(--caption-width, 80%);
  }
  .viewport {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
  }
  /* Only for providers whose row grows on its own: Gemini keeps one turn open
     across continuous speech, so without a ceiling that single row eats the
     screen. Deepgram's rows are already cut to about a line by the chunker,
     and clamping them would crop the wrap README documents as expected.
     column-reverse is what pins content to the bottom and sends the overflow
     off the top; with a single child it lays out identically to the unclamped
     rule whenever the content fits.

     The two halves are capped separately rather than the pair as a whole:
     capping only the pair keeps its bottom, which is entirely translation, and
     the source line disappears — half the point of a bilingual caption. */
  .viewport.clamped .original,
  .viewport.clamped .translation {
    display: flex;
    flex-direction: column-reverse;
    max-height: calc(
      var(--caption-max-rows, 2) * var(--caption-line-height) * 1em
    );
    overflow: hidden;
  }
  /* Restated because the rule above out-specifies the shared :empty rule. */
  .viewport.clamped .original:empty,
  .viewport.clamped .translation:empty { display: none; }
  /* The pair budget above already fits one row inside this, so this only
     trims older rows off the top when several are on screen at once. */
  .viewport.clamped {
    flex-direction: column-reverse;
    justify-content: flex-start;
    max-height: calc(
      var(--caption-max-rows, 2) * (
        (var(--caption-original-size, 24px) + var(--caption-translation-size, 22px))
          * var(--caption-line-height)
        + var(--caption-translation-gap)
        + 2 * var(--caption-pair-padding)
      )
    );
  }
  .track { display: flex; flex-direction: column; }
  .pair { padding: var(--caption-pair-padding) 0; }
  .original {
    font-size: var(--caption-original-size, 24px);
    font-weight: 650;
    overflow-wrap: break-word;
    text-shadow: 0 1px 2px #000;
  }
  .translation {
    color: #fde68a;
    font-size: var(--caption-translation-size, 22px);
    font-weight: 550;
    margin-top: var(--caption-translation-gap);
    overflow-wrap: break-word;
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
  .track.instant { transition: none; }
  @media (prefers-reduced-motion: no-preference) {
    .captions { transition: opacity 160ms ease-out; }
    .track { transition: transform 220ms ease-out; }
  }
`,m=class{document;host;nativeCue;nativeTrack;nativeVideo;pairs=[];pairElements=new Map;statusElement;statusTextValue=``;trackElement;viewportElement;constructor(e){this.document=e}show(e){this.host||this.createHost(),this.setAppearance(e),this.position()}hide(){this.disableNativeTextTrack(),this.host?.remove(),this.host=void 0,this.statusElement=void 0,this.trackElement=void 0,this.viewportElement=void 0,this.pairElements.clear(),this.pairs=[],this.statusTextValue=``}setAppearance(e){let t=this.host?.style;t&&(t.setProperty(`--caption-original-size`,`${e.originalFontSize}px`),t.setProperty(`--caption-translation-size`,`${e.translationFontSize}px`),t.setProperty(`--caption-bg-opacity`,`${e.backgroundOpacity/100}`),t.setProperty(`--caption-bottom-offset`,`${e.bottomOffset}%`),t.setProperty(`--caption-width`,`${e.captionWidth}%`),t.setProperty(`--caption-max-rows`,`${e.maxVisibleRows}`),this.viewportElement?.classList.toggle(`clamped`,e.maxVisibleRows>0))}setWindow(e){this.pairs=e,this.syncNativeCue();let t=this.trackElement;if(!t)return;let n=new Set(e.map(e=>e.id)),r=[...t.children].filter(e=>e instanceof HTMLElement&&!n.has(e.dataset.pairId??``)),i=r.length>0&&e.some(e=>!this.pairElements.has(e.id))&&!this.prefersReducedMotion(),a=i?this.viewportElement?.offsetHeight??0:0;for(let n of e){let e=this.pairElements.get(n.id);if(e){this.writePair(e,n);continue}let r=this.createPair(n);t.append(r),this.pairElements.set(n.id,r)}if(r.length!==0){if(!i){this.removePairs(r);return}this.animatePush(r,a)}}prefersReducedMotion(){return this.document.defaultView?.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches===!0}animatePush(e,t){let n=this.trackElement,r=this.viewportElement;if(!n||!r){this.removePairs(e);return}let i=e.reduce((e,t)=>e+t.offsetHeight,0);t>0&&(r.style.height=`${t}px`),n.classList.add(`instant`),n.style.transform=`translateY(${i}px)`,n.offsetHeight;let a=this.document.defaultView,o=()=>{n.classList.remove(`instant`),n.style.transform=``};a?.requestAnimationFrame?a.requestAnimationFrame(o):o();let s=()=>{this.removePairs(e),o(),r.style.height=``};a?.setTimeout?a.setTimeout(s,260):s()}setSessionError(e){this.statusTextValue=n(u[e]??`errorUnknown`),this.statusElement&&(this.statusElement.textContent=this.statusTextValue),this.syncNativeCue()}clearSessionError(){this.statusTextValue=``,this.statusElement&&(this.statusElement.textContent=``),this.syncNativeCue()}position(){if(!this.host)return;let e=this.document.fullscreenElement,t=e instanceof HTMLElement&&!(e instanceof HTMLVideoElement)?e:this.document.documentElement;this.host.parentElement!==t&&t.append(this.host),e instanceof HTMLVideoElement?this.enableNativeTextTrack(e):this.disableNativeTextTrack();let n=f(this.document);if(!n){Object.assign(this.host.style,{height:`100vh`,left:`0px`,top:`0px`,width:`100vw`}),this.host.dataset.mode=`viewport`;return}let r=n.getBoundingClientRect();Object.assign(this.host.style,{height:`${r.height}px`,left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`}),this.host.dataset.mode=`video`}createHost(){let e=this.document.createElement(`div`);e.dataset.bilingualCaptionRoot=``,Object.assign(e.style,{display:`block`,pointerEvents:`none`,position:`fixed`,zIndex:`2147483647`});let t=e.attachShadow({mode:`open`}),n=this.document.createElement(`style`);n.textContent=p;let r=this.document.createElement(`div`);r.className=`stage`;let i=this.document.createElement(`div`);i.className=`captions`,i.setAttribute(`aria-live`,`polite`),i.setAttribute(`role`,`status`);let a=this.document.createElement(`div`);a.className=`viewport`;let o=this.document.createElement(`div`);o.className=`track`,a.append(o);let s=this.document.createElement(`div`);s.className=`status-message`,s.textContent=this.statusTextValue,i.append(a,s),r.append(i),t.append(n,r),this.document.documentElement.append(e),this.host=e,this.statusElement=s,this.trackElement=o,this.viewportElement=a;for(let e of this.pairs){let t=this.createPair(e);o.append(t),this.pairElements.set(e.id,t)}}createPair(e){let t=this.document.createElement(`div`);t.className=`pair`,t.dataset.pairId=e.id;let n=this.document.createElement(`div`);n.className=`original`;let r=this.document.createElement(`div`);return r.className=`translation`,t.append(n,r),this.writePair(t,e),t}writePair(e,t){let n=e.querySelector(`.original`),r=e.querySelector(`.translation`);n&&(n.textContent=t.original),r&&(r.textContent=t.translation)}removePairs(e){for(let t of e){let e=t.dataset.pairId;e&&this.pairElements.delete(e),t.remove()}}enableNativeTextTrack(e){if(this.nativeVideo===e)return;this.disableNativeTextTrack();let t=this.document.defaultView?.VTTCue;if(!t)return;let r=e.addTextTrack(`captions`,n(`captionTrackLabel`));r.mode=`showing`;let i=new t(0,1e9,``);r.addCue(i),this.nativeCue=i,this.nativeTrack=r,this.nativeVideo=e,this.syncNativeCue()}disableNativeTextTrack(){if(this.nativeCue)try{this.nativeTrack?.removeCue(this.nativeCue)}catch{}this.nativeTrack&&(this.nativeTrack.mode=`disabled`),this.nativeCue=void 0,this.nativeTrack=void 0,this.nativeVideo=void 0}syncNativeCue(){this.nativeCue&&(this.nativeCue.text=[...this.pairs.flatMap(e=>[e.original,e.translation]),this.statusTextValue].filter(Boolean).join(`
`))}},h=e({matches:[`https://*/*`],main(){let e=new m(document),t=!1,n=()=>{t||(t=!0,requestAnimationFrame(()=>{t=!1,e.position()}))};new MutationObserver(n).observe(document.documentElement,{childList:!0,subtree:!0}),window.addEventListener(`resize`,n),window.addEventListener(`scroll`,n,{passive:!0}),document.addEventListener(`fullscreenchange`,n);let r=async()=>{let e=l((await chrome.storage.local.get(`settings`)).settings??i);return{backgroundOpacity:e.backgroundOpacity,bottomOffset:e.bottomOffset,captionWidth:e.captionWidth,maxVisibleRows:e.transcriber===`gemini`?e.captionRows:0,originalFontSize:e.originalFontSize,translationFontSize:e.translationFontSize}};chrome.storage.onChanged.addListener((t,n)=>{n!==`local`||!t.settings||r().then(t=>e.setAppearance(t))}),chrome.runtime.onMessage.addListener((t,n,i)=>{switch(t.type){case`CONTENT_PING`:i({ok:!0});break;case`OVERLAY_SHOW`:r().then(t=>e.show(t));break;case`OVERLAY_HIDE`:e.hide();break;case`CAPTION_WINDOW`:e.setWindow(t.payload.pairs);break;case`SESSION_ERROR`:e.setSessionError(t.payload.code);break;case`SESSION_ERROR_CLEAR`:e.clearSessionError()}return!1}),chrome.runtime.sendMessage({target:`background`,type:`CONTENT_READY`})}}),g={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)},_=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome,v=class e extends Event{static EVENT_NAME=y(`wxt:locationchange`);constructor(t,n){super(e.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=n}};function y(e){return`${_?.runtime?.id}:captions:${e}`}var b=typeof globalThis.navigation?.addEventListener==`function`;function x(e){let t,n=!1;return{run(){n||(n=!0,t=new URL(location.href),b?globalThis.navigation.addEventListener(`navigate`,e=>{let n=new URL(e.destination.url);n.href!==t.href&&(window.dispatchEvent(new v(n,t)),t=n)},{signal:e.signal}):e.setInterval(()=>{let e=new URL(location.href);e.href!==t.href&&(window.dispatchEvent(new v(e,t)),t=e)},1e3))}}}var S=class e{static SCRIPT_STARTED_MESSAGE_TYPE=y(`wxt:content-script-started`);id;abortController;locationWatcher=x(this);constructor(e,t){this.contentScriptName=e,this.options=t,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(e){return this.abortController.abort(e)}get isInvalid(){return _.runtime?.id??this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(e){return this.signal.addEventListener(`abort`,e),()=>this.signal.removeEventListener(`abort`,e)}block(){return new Promise(()=>{})}setInterval(e,t){let n=setInterval(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearInterval(n)),n}setTimeout(e,t){let n=setTimeout(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearTimeout(n)),n}requestAnimationFrame(e){let t=requestAnimationFrame((...t)=>{this.isValid&&e(...t)});return this.onInvalidated(()=>cancelAnimationFrame(t)),t}requestIdleCallback(e,t){let n=requestIdleCallback((...t)=>{this.signal.aborted||e(...t)},t);return this.onInvalidated(()=>cancelIdleCallback(n)),n}addEventListener(e,t,n,r){t===`wxt:locationchange`&&this.isValid&&this.locationWatcher.run(),e.addEventListener?.(t.startsWith(`wxt:`)?y(t):t,n,{...r,signal:this.signal})}notifyInvalidated(){this.abort(`Content script context invalidated`),g.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(e.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),this.options?.noScriptStartedPostMessage||window.postMessage({type:e.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},`*`)}verifyScriptStartedEvent(e){let t=e.detail?.contentScriptName===this.contentScriptName,n=e.detail?.messageId===this.id;return t&&!n}listenForNewerScripts(){let t=e=>{!(e instanceof CustomEvent)||!this.verifyScriptStartedEvent(e)||this.notifyInvalidated()};document.addEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t),this.onInvalidated(()=>document.removeEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t))}},C={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)};return(async()=>{try{let{main:e,...t}=h;return await e(new S(`captions`,t))}catch(e){throw C.error(`The content script "captions" crashed on startup!`,e),e}})()})();