import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadNotoJP } from '@remotion/google-fonts/NotoSansJP';
import { loadFont as loadNotoTC } from '@remotion/google-fonts/NotoSansTC';
import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { COPY, type CaptionLine, type Copy, type Locale } from './copy';

const inter = loadInter('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin'] });
const notoTC = loadNotoTC('normal', { weights: ['500', '700'], ignoreTooManyRequestsWarning: true });
const notoJP = loadNotoJP('normal', { weights: ['500', '700'], ignoreTooManyRequestsWarning: true });
const FONT = `${inter.fontFamily}, ${notoTC.fontFamily}, ${notoJP.fontFamily}, sans-serif`;

// Palette from .superdesign/design-system.md so the video matches the extension.
const C = {
  bg: '#0b1120',
  surface: '#111827',
  surface2: '#182235',
  field: '#0f172a',
  border: '#334155',
  text: '#f8fafc',
  muted: '#a8b3c5',
  teal: '#14b8a6',
  tealDark: '#0d9488',
  tealLight: '#5eead4',
  amber: '#fde68a',
};

// Timeline, in frames at 30fps (25s total).
export const DURATION = 750;
const T = {
  cursorToIcon: [95, 130],
  iconClick: 135,
  cursorToStart: [155, 190],
  startClick: 195,
  popupClose: [222, 238],
  line1: 250,
  line2: 360,
  cursorToTab: [478, 505],
  tabClick: 510,
  badge: 522,
  cursorToIcon2: [535, 562],
  iconClick2: 567,
  line3: 582,
  end: 630,
} as const;

// Canvas-space geometry of the fake browser.
const B = { x: 210, y: 220, w: 1500, h: 800 };
const TAB_H = 52;
const BAR_H = 54;
const CONTENT_Y = B.y + TAB_H + BAR_H;
const ICON = { x: B.x + B.w - 56, y: B.y + TAB_H + BAR_H / 2 };
const TAB2 = { x: B.x + 24 + 300 + 150, y: B.y + TAB_H / 2 };
const POPUP = { x: ICON.x - 360, y: CONTENT_Y + 8, w: 390 };
const START_BTN = { x: POPUP.x + POPUP.w / 2, y: POPUP.y + 452 };
const REST = { x: 1580, y: 640 };

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

export const Intro = ({ locale }: { locale: Locale }) => {
  const copy = COPY[locale];
  const frame = useCurrentFrame();
  const endFade = interpolate(frame, [T.end - 12, T.end], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, color: C.text }}>
      <Glow />
      <AbsoluteFill style={{ opacity: endFade }}>
        <Headlines copy={copy} />
        <Browser copy={copy} />
        <Popup copy={copy} />
        <Cursor />
      </AbsoluteFill>
      <Sequence from={T.end}>
        <EndCard copy={copy} />
      </Sequence>
    </AbsoluteFill>
  );
};

const Glow = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(1200px 700px at 15% 0%, rgba(20,184,166,.18), transparent 60%), radial-gradient(900px 600px at 100% 100%, rgba(129,140,248,.14), transparent 60%)',
    }}
  />
);

const Headlines = ({ copy }: { copy: Copy }) => {
  const items: [string, number, number][] = [
    [copy.hook, 0, 92],
    [copy.oneClick, 92, 240],
    [copy.live, 240, 476],
    [copy.follow, 476, T.end],
  ];
  return (
    <>
      {items.map(([text, from, to]) => (
        <Headline key={text} text={text} from={from} to={to} />
      ))}
    </>
  );
};

const Headline = ({ text, from, to }: { text: string; from: number; to: number }) => {
  const frame = useCurrentFrame();
  if (frame < from - 1 || frame > to) return null;
  const inP = from === 0 ? 1 : interpolate(frame, [from, from + 14], [0, 1], { ...clamp, easing: ease });
  const outP = interpolate(frame, [to - 10, to], [1, 0], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        top: 70,
        width: '100%',
        textAlign: 'center',
        fontSize: 64,
        fontWeight: 800,
        letterSpacing: '-0.02em',
        opacity: Math.min(inP, outP),
        transform: `translateY(${(1 - inP) * 24}px)`,
      }}
    >
      {text}
    </div>
  );
};

const Browser = ({ copy }: { copy: Copy }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const onSecondTab = frame >= T.tabClick;

  return (
    <div
      style={{
        position: 'absolute',
        left: B.x,
        top: B.y,
        width: B.w,
        height: B.h,
        borderRadius: 18,
        overflow: 'hidden',
        background: C.surface,
        border: `1px solid ${C.border}`,
        boxShadow: '0 40px 120px rgba(0,0,0,.55)',
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40}px)`,
      }}
    >
      <TabStrip copy={copy} active={onSecondTab ? 1 : 0} />
      <AddressBar />
      <div style={{ position: 'absolute', top: TAB_H + BAR_H, left: 0, right: 0, bottom: 0 }}>
        <FakeVideo variant={onSecondTab ? 1 : 0} />
        <Captions copy={copy} />
      </div>
    </div>
  );
};

const TabStrip = ({ copy, active }: { copy: Copy; active: 0 | 1 }) => (
  <div
    style={{
      height: TAB_H,
      background: '#0a0f1c',
      display: 'flex',
      alignItems: 'flex-end',
      paddingLeft: 24,
      gap: 6,
    }}
  >
    <div style={{ display: 'flex', gap: 8, position: 'absolute', left: 22, top: 20 }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
      ))}
    </div>
    <div style={{ width: 70 }} />
    {copy.tabs.map((title, i) => (
      <div
        key={title}
        style={{
          width: 290,
          height: 40,
          borderRadius: '12px 12px 0 0',
          background: i === active ? C.surface : 'transparent',
          color: i === active ? C.text : C.muted,
          fontSize: 19,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 16px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: 16, height: 16, borderRadius: 4, background: i === 0 ? '#f97316' : '#818cf8' }} />
        {title}
      </div>
    ))}
  </div>
);

const AddressBar = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const badgeIn = spring({ frame: frame - T.badge, fps, config: { damping: 12 } });
  const showBadge = frame >= T.badge && frame < T.iconClick2;
  const running = (frame >= T.startClick && frame < T.tabClick) || frame >= T.iconClick2;

  return (
    <div
      style={{
        height: BAR_H,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 20px',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 36,
          borderRadius: 18,
          background: C.field,
          color: C.muted,
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
        }}
      >
        https://video.example/watch
      </div>
      <div style={{ position: 'relative', width: 36, height: 36 }}>
        <Img
          src={staticFile('icon.png')}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            boxShadow: running ? `0 0 0 3px ${C.teal}` : 'none',
          }}
        />
        {showBadge && (
          <div
            style={{
              position: 'absolute',
              right: -8,
              bottom: -6,
              minWidth: 22,
              height: 18,
              borderRadius: 9,
              background: C.teal,
              color: C.bg,
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${badgeIn})`,
            }}
          >
            CC
          </div>
        )}
      </div>
    </div>
  );
};

// A brand-free stand-in for a video player.
const FakeVideo = ({ variant }: { variant: 0 | 1 }) => {
  const frame = useCurrentFrame();
  const progress = ((frame % 600) / 600) * 0.6 + (variant ? 0.12 : 0.28);
  const bg =
    variant === 0
      ? 'linear-gradient(160deg, #1e3a5f 0%, #0f2742 45%, #3b1d3f 100%)'
      : 'linear-gradient(160deg, #1f2937 0%, #312e81 55%, #0b1120 100%)';
  return (
    <AbsoluteFill style={{ background: bg }}>
      {variant === 0 ? <MarketScene /> : <LectureScene />}
      <div style={{ position: 'absolute', left: 28, right: 28, bottom: 22, height: 6, borderRadius: 3, background: 'rgba(255,255,255,.2)' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 3, background: '#ef4444' }} />
      </div>
    </AbsoluteFill>
  );
};

const MarketScene = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 40) * 12;
  return (
    <AbsoluteFill>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 80 + i * 280 + drift,
            top: 130 + (i % 2) * 40,
            width: 220,
            height: 200,
            borderRadius: '110px 110px 16px 16px',
            background: ['#f59e0b', '#ef4444', '#14b8a6', '#f97316', '#60a5fa'][i],
            opacity: 0.35,
          }}
        />
      ))}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 360, height: 60, background: 'rgba(0,0,0,.25)' }} />
    </AbsoluteFill>
  );
};

const LectureScene = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 160,
          top: 90,
          width: 760,
          height: 300,
          borderRadius: 14,
          background: 'rgba(15,23,42,.7)',
          border: '1px solid rgba(255,255,255,.12)',
          padding: 36,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {[0.9, 0.7, 0.8, 0.5].map((w, i) => (
          <div key={i} style={{ height: 22, width: `${w * 100}%`, borderRadius: 11, background: i === 0 ? C.tealLight : 'rgba(255,255,255,.22)' }} />
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 220,
          top: 150 + Math.sin(frame / 25) * 4,
          width: 150,
          height: 150,
          borderRadius: 75,
          background: 'rgba(255,255,255,.12)',
          border: '1px solid rgba(255,255,255,.2)',
        }}
      />
    </AbsoluteFill>
  );
};

type TimedLine = CaptionLine & { at: number };

const Captions = ({ copy }: { copy: Copy }) => {
  const frame = useCurrentFrame();
  const firstRunning = frame >= T.line1 - 10 && frame < T.tabClick;
  const secondRunning = frame >= T.line3 - 10;
  if (!firstRunning && !secondRunning) return null;

  const lines: TimedLine[] = secondRunning
    ? [{ ...copy.secondTab[0], at: T.line3 }]
    : [
        { ...copy.firstTab[0], at: T.line1 },
        { ...copy.firstTab[1], at: T.line2 },
      ];
  const start = secondRunning ? T.line3 - 10 : T.line1 - 10;
  const appear = interpolate(frame, [start, start + 10], [0, 1], clamp);

  return (
    <div
      style={{
        position: 'absolute',
        left: '15%',
        width: '70%',
        bottom: 56,
        minHeight: 210,
        borderRadius: 10,
        background: 'rgba(5,8,16,.78)',
        border: '1px solid rgba(255,255,255,.14)',
        boxShadow: '0 8px 28px rgba(0,0,0,.34)',
        padding: '22px 32px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 16,
        textAlign: 'center',
        opacity: appear,
      }}
    >
      {lines.map((line) => (
        <CaptionPair key={line.source} line={line} />
      ))}
    </div>
  );
};

const CaptionPair = ({ line }: { line: TimedLine }) => {
  const frame = useCurrentFrame();
  if (frame < line.at) return null;
  const sourceChars = [...line.source];
  const shown = Math.floor(interpolate(frame, [line.at, line.at + 55], [0, sourceChars.length], clamp));
  const translation = interpolate(frame, [line.at + 30, line.at + 48], [0, 1], clamp);
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 650, lineHeight: 1.35, color: C.text }}>
        {sourceChars.slice(0, shown).join('')}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 550,
          lineHeight: 1.35,
          color: C.amber,
          opacity: translation,
          transform: `translateY(${(1 - translation) * 8}px)`,
        }}
      >
        {line.translation}
      </div>
    </div>
  );
};

const Popup = ({ copy }: { copy: Copy }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < T.iconClick || frame > T.popupClose[1]) return null;
  const open = spring({ frame: frame - T.iconClick, fps, config: { damping: 18, stiffness: 180 } });
  const close = interpolate(frame, [T.popupClose[0], T.popupClose[1]], [1, 0], clamp);
  const running = frame >= T.startClick;
  const press = frame >= T.startClick && frame < T.startClick + 6 ? 0.97 : 1;

  const card: CSSProperties = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };
  const field = (text: ReactNode) => (
    <div
      style={{
        height: 44,
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        background: C.field,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        fontSize: 16,
      }}
    >
      {text}
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: POPUP.x,
        top: POPUP.y,
        width: POPUP.w,
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: '0 24px 60px rgba(0,0,0,.6)',
        transformOrigin: 'top right',
        transform: `scale(${0.92 + open * 0.08})`,
        opacity: Math.min(open, close),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: C.tealLight, fontSize: 13, fontWeight: 800, letterSpacing: '0.14em' }}>LIVE CAPTIONS</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>Bilingual Live Captions</div>
        </div>
        <div
          style={{
            fontSize: 14,
            padding: '5px 12px',
            borderRadius: 999,
            border: `1px solid ${running ? C.teal : C.border}`,
            color: running ? C.tealLight : C.muted,
          }}
        >
          {running ? copy.running : copy.idle}
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Gemini live translate 3.5</div>
        <div style={{ fontSize: 14, color: C.tealLight }}>API key ✓</div>
      </div>
      <div style={{ ...card, flexDirection: 'row' }}>
        <div style={{ flex: 1 }}>{field(copy.sourceLabel)}</div>
        <div style={{ flex: 1 }}>{field(copy.targetLabel)}</div>
      </div>
      <div
        style={{
          height: 56,
          borderRadius: 10,
          background: running ? C.surface2 : C.tealDark,
          border: `1px solid ${running ? C.border : C.teal}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 17,
          fontWeight: 700,
          transform: `scale(${press})`,
        }}
      >
        {copy.start}
      </div>
    </div>
  );
};

type Point = { x: number; y: number };

const Cursor = () => {
  const frame = useCurrentFrame();
  const path: [readonly [number, number], Point, Point][] = [
    [T.cursorToIcon, REST, ICON],
    [T.cursorToStart, ICON, START_BTN],
    [[T.popupClose[0], T.popupClose[1] + 20], START_BTN, REST],
    [T.cursorToTab, REST, TAB2],
    [T.cursorToIcon2, TAB2, ICON],
    [[T.iconClick2 + 8, T.iconClick2 + 40], ICON, REST],
  ];
  let pos = REST;
  for (const [[a, b], from, to] of path) {
    if (frame >= a) {
      const p = interpolate(frame, [a, b], [0, 1], { ...clamp, easing: ease });
      pos = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
    }
  }
  const visible = interpolate(frame, [80, 92], [0, 1], clamp);
  const clicks = [T.iconClick, T.startClick, T.tabClick, T.iconClick2];

  return (
    <>
      {clicks.map((at) => (
        <Ripple key={at} at={at} />
      ))}
      <svg
        width={34}
        height={34}
        viewBox="0 0 24 24"
        style={{ position: 'absolute', left: pos.x - 4, top: pos.y - 2, opacity: visible, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.6))' }}
      >
        <path d="M4 2l16 10-7 1.5L9.5 21z" fill="#fff" stroke="#0b1120" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </>
  );
};

const Ripple = ({ at }: { at: number }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > at + 18) return null;
  const p = (frame - at) / 18;
  const target = at === T.tabClick ? TAB2 : at === T.startClick ? START_BTN : ICON;
  return (
    <div
      style={{
        position: 'absolute',
        left: target.x - 30 * p - 6,
        top: target.y - 30 * p - 6,
        width: 12 + 60 * p,
        height: 12 + 60 * p,
        borderRadius: '50%',
        border: `3px solid ${C.tealLight}`,
        opacity: 1 - p,
      }}
    />
  );
};

const EndCard = ({ copy }: { copy: Copy }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const shot = spring({ frame: frame - 12, fps, config: { damping: 200 }, durationInFrames: 30 });

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 34, flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: enter, transform: `translateY(${(1 - enter) * 30}px)` }}>
        <Img src={staticFile('icon.png')} style={{ width: 104, height: 104, borderRadius: 22 }} />
        <div>
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: '-0.02em' }}>Bilingual Live Captions</div>
          <div style={{ fontSize: 32, color: C.muted, marginTop: 6 }}>{copy.tagline}</div>
        </div>
      </div>
      <div style={{ opacity: shot, transform: `scale(${0.96 + shot * 0.04})`, textAlign: 'center' }}>
        {/* Crop of a real store screenshot: just the caption surface. */}
        <div
          style={{
            width: 920,
            height: 256,
            borderRadius: 14,
            overflow: 'hidden',
            border: `1px solid ${C.border}`,
            boxShadow: '0 30px 80px rgba(0,0,0,.5)',
            position: 'relative',
          }}
        >
          <Img src={staticFile('real-captions.png')} style={{ position: 'absolute', left: -180, top: -452, width: 1280, height: 800 }} />
        </div>
        <div style={{ fontSize: 20, color: C.muted, marginTop: 12 }}>{copy.realProduct}</div>
      </div>
      <div
        style={{
          opacity: shot,
          background: C.tealDark,
          border: `1px solid ${C.teal}`,
          borderRadius: 14,
          padding: '20px 44px',
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        {copy.cta}
      </div>
    </AbsoluteFill>
  );
};
