import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
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
const FONT = `${inter.fontFamily}, ${notoTC.fontFamily}, sans-serif`;

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
  cursorToSidebar: [480, 508],
  sidebarClick: 513,
  line3: 548,
  end: 630,
} as const;

// Canvas-space geometry of the fake browser.
const B = { x: 210, y: 220, w: 1500, h: 800 };
const TAB_H = 52;
const BAR_H = 54;
const CONTENT_Y = B.y + TAB_H + BAR_H;
const ICON = { x: B.x + B.w - 56, y: B.y + TAB_H + BAR_H / 2 };
const POPUP = { x: ICON.x - 360, y: CONTENT_Y + 8, w: 390 };
const START_BTN = { x: POPUP.x + POPUP.w / 2, y: POPUP.y + 296 };
// Floating caption surface, relative to the page content area.
const CAP = { x: 225, y: 380, w: 1050, h: 270, header: 46 };
const SIDEBAR_BTN = { x: B.x + CAP.x + CAP.w - 34, y: CONTENT_Y + CAP.y + CAP.header / 2 };
const PANEL_W = 470;
const REST = { x: 1580, y: 640 };
const REST_LEFT = { x: 820, y: 560 };

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
    [copy.sidebar, 476, T.end],
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
  const panel = spring({ frame: frame - T.sidebarClick, fps, config: { damping: 200 }, durationInFrames: 20 });
  const panelW = frame >= T.sidebarClick ? PANEL_W * panel : 0;

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
      <TabStrip copy={copy} />
      <AddressBar />
      <div style={{ position: 'absolute', top: TAB_H + BAR_H, left: 0, right: panelW, bottom: 0, overflow: 'hidden' }}>
        <FakeVideo />
        <FloatingCaptions copy={copy} />
      </div>
      {panelW > 0 && <SidePanel copy={copy} width={PANEL_W} offset={PANEL_W - panelW} />}
    </div>
  );
};

const TabStrip = ({ copy }: { copy: Copy }) => (
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
    <div
      style={{
        width: 400,
        height: 40,
        borderRadius: '12px 12px 0 0',
        background: C.surface,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontSize: 19,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 16px',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ width: 16, height: 16, borderRadius: 4, background: '#f97316' }} />
      {copy.tab}
    </div>
  </div>
);

const AddressBar = () => {
  const frame = useCurrentFrame();
  const running = frame >= T.startClick;
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
      <Img
        src={staticFile('icon.png')}
        style={{ width: 36, height: 36, borderRadius: 8, boxShadow: running ? `0 0 0 3px ${C.teal}` : 'none' }}
      />
    </div>
  );
};

// A brand-free stand-in for a laptop launch film: an open laptop on a dark
// stage, its display cycling through vivid OLED colours.
const FakeVideo = () => {
  const frame = useCurrentFrame();
  const progress = 0.28 + (frame / DURATION) * 0.6;
  const hue = (frame * 0.6) % 360;
  const zoom = 1 + (frame / DURATION) * 0.06;
  return (
    <AbsoluteFill
      style={{ background: 'radial-gradient(900px 520px at 50% 30%, #1c2333 0%, #0a0c12 60%, #050608 100%)' }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 34,
          width: 640,
          transform: `translateX(-50%) scale(${zoom})`,
          transformOrigin: '50% 0%',
        }}
      >
        {/* Display */}
        <div
          style={{
            margin: '0 auto',
            width: 520,
            height: 326,
            borderRadius: '18px 18px 6px 6px',
            background: '#0b0b0e',
            border: '2px solid #3a3d45',
            padding: 12,
            boxShadow: `0 0 120px hsla(${hue}, 90%, 55%, .28)`,
            position: 'relative',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 8,
              position: 'relative',
              overflow: 'hidden',
              background: `radial-gradient(circle at 30% 35%, hsl(${hue}, 95%, 60%) 0%, transparent 45%),
                radial-gradient(circle at 72% 60%, hsl(${(hue + 120) % 360}, 95%, 55%) 0%, transparent 50%),
                radial-gradient(circle at 50% 100%, hsl(${(hue + 240) % 360}, 90%, 45%) 0%, transparent 55%),
                #000`,
            }}
          >
            <TouchDemo />
          </div>
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              width: 70,
              height: 12,
              transform: 'translateX(-50%)',
              borderRadius: '0 0 7px 7px',
              background: '#0b0b0e',
            }}
          />
        </div>
        {/* Base */}
        <div
          style={{
            width: 640,
            height: 16,
            borderRadius: '2px 2px 14px 14px',
            background: 'linear-gradient(#9ca3af, #4b5563)',
          }}
        />
        <div style={{ width: 120, height: 5, margin: '-16px auto 0', borderRadius: '0 0 6px 6px', background: '#374151' }} />
      </div>
      <div style={{ position: 'absolute', left: 28, right: 28, bottom: 22, height: 6, borderRadius: 3, background: 'rgba(255,255,255,.2)' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 3, background: '#ef4444' }} />
      </div>
    </AbsoluteFill>
  );
};

// Finger gestures on the laptop display, timed to the touch-screen captions:
// a tap, a swipe that drags a photo, a pinch that zooms it, then another tap.
const TOUCH = {
  tap1: 255,
  swipe: [372, 410],
  pinch: [440, 476],
  tap2: 565,
} as const;
const SCREEN = { w: 492, h: 298 };

const TouchDemo = () => {
  const frame = useCurrentFrame();
  const swipe = interpolate(frame, [TOUCH.swipe[0], TOUCH.swipe[1]], [0, 1], { ...clamp, easing: ease });
  const pinch = interpolate(frame, [TOUCH.pinch[0], TOUCH.pinch[1]], [0, 1], { ...clamp, easing: ease });
  const cardX = -110 * swipe;
  const cardScale = 1 + 0.4 * pinch;
  const cx = SCREEN.w / 2 + cardX;
  const cy = SCREEN.h / 2;

  const fingers: { x: number; y: number; from: number; to: number }[] = [
    { x: SCREEN.w / 2, y: cy, from: TOUCH.tap1 - 6, to: TOUCH.tap1 + 10 },
    { x: SCREEN.w / 2 + 40 - 150 * swipe, y: cy + 10, from: TOUCH.swipe[0] - 6, to: TOUCH.swipe[1] + 6 },
    { x: cx - 18 - 70 * pinch, y: cy + 12 + 30 * pinch, from: TOUCH.pinch[0] - 6, to: TOUCH.pinch[1] + 6 },
    { x: cx + 18 + 70 * pinch, y: cy - 12 - 30 * pinch, from: TOUCH.pinch[0] - 6, to: TOUCH.pinch[1] + 6 },
    { x: cx, y: cy, from: TOUCH.tap2 - 6, to: TOUCH.tap2 + 10 },
  ];

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: cx - 100,
          top: cy - 64,
          width: 200,
          height: 128,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #fde68a 0%, #f97316 45%, #7c3aed 100%)',
          border: '2px solid rgba(255,255,255,.7)',
          boxShadow: '0 12px 30px rgba(0,0,0,.45)',
          transform: `scale(${cardScale})`,
        }}
      />
      {fingers.map((f, i) => {
        if (frame < f.from || frame > f.to) return null;
        const o = Math.min(
          interpolate(frame, [f.from, f.from + 6], [0, 1], clamp),
          interpolate(frame, [f.to - 6, f.to], [1, 0], clamp),
        );
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: f.x - 20,
              top: f.y - 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255,255,255,.75)',
              border: '3px solid rgba(255,255,255,.95)',
              boxShadow: '0 0 0 8px rgba(255,255,255,.18), 0 4px 14px rgba(0,0,0,.4)',
              opacity: o,
            }}
          />
        );
      })}
      {[TOUCH.tap1, TOUCH.tap2].map((at) => {
        if (frame < at || frame > at + 20) return null;
        const p = (frame - at) / 20;
        const x = at === TOUCH.tap1 ? SCREEN.w / 2 : cx;
        return (
          <div
            key={at}
            style={{
              position: 'absolute',
              left: x - 20 - 50 * p,
              top: cy - 20 - 50 * p,
              width: 40 + 100 * p,
              height: 40 + 100 * p,
              borderRadius: '50%',
              border: '3px solid rgba(255,255,255,.9)',
              opacity: 1 - p,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

type TimedLine = CaptionLine & { at: number };

const timedLines = (copy: Copy): TimedLine[] => [
  { ...copy.lines[0], at: T.line1 },
  { ...copy.lines[1], at: T.line2 },
  { ...copy.lines[2], at: T.line3 },
];

// Reveals the source text character by character, then fades in the translation.
const useReveal = (line: TimedLine) => {
  const frame = useCurrentFrame();
  const chars = [...line.source];
  const shown = Math.floor(interpolate(frame, [line.at, line.at + 55], [0, chars.length], clamp));
  return {
    visible: frame >= line.at,
    source: chars.slice(0, shown).join(''),
    translation: interpolate(frame, [line.at + 30, line.at + 48], [0, 1], clamp),
  };
};

// Mirrors the extension's floating caption surface: a header with controls
// and teal resize corners around the caption body.
const FloatingCaptions = ({ copy }: { copy: Copy }) => {
  const frame = useCurrentFrame();
  if (frame < T.line1 - 10) return null;
  const appear = interpolate(frame, [T.line1 - 10, T.line1], [0, 1], clamp);
  const leave = interpolate(frame, [T.sidebarClick, T.sidebarClick + 8], [1, 0], clamp);
  const hoverSidebar = frame >= T.cursorToSidebar[1] - 4;
  const lines = timedLines(copy).slice(0, 2);

  return (
    <div
      style={{
        position: 'absolute',
        left: CAP.x,
        top: CAP.y,
        width: CAP.w,
        height: CAP.h,
        opacity: Math.min(appear, leave),
      }}
    >
      <Corners />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 10,
          overflow: 'hidden',
          background: 'rgba(5,8,16,.78)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 8px 28px rgba(0,0,0,.34)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            height: CAP.header,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 14px 0 18px',
            background: 'rgba(17,24,39,.92)',
            borderBottom: '1px solid rgba(255,255,255,.08)',
          }}
        >
          <Grip />
          <div style={{ fontSize: 15, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', flex: 1 }}>{copy.captionLabel}</div>
          <HeaderIcons hoverSidebar={hoverSidebar} />
        </div>
        <div
          style={{
            flex: 1,
            padding: '14px 32px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: 14,
            textAlign: 'center',
          }}
        >
          {lines.map((line) => (
            <FloatingPair key={line.source} line={line} />
          ))}
        </div>
      </div>
    </div>
  );
};

const FloatingPair = ({ line }: { line: TimedLine }) => {
  const r = useReveal(line);
  if (!r.visible) return null;
  return (
    <div>
      <div style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.35, color: C.text }}>{r.source}</div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.35,
          color: C.amber,
          opacity: r.translation,
          transform: `translateY(${(1 - r.translation) * 8}px)`,
        }}
      >
        {line.translation}
      </div>
    </div>
  );
};

const Corners = () => {
  const arm = 30;
  const t = 6;
  const out = -14;
  const corner = (pos: CSSProperties, radius: string, borders: CSSProperties) => (
    <div style={{ position: 'absolute', width: arm, height: arm, borderRadius: radius, ...pos, ...borders }} />
  );
  const line = `${t}px solid ${C.tealLight}`;
  return (
    <>
      {corner({ left: out, top: out }, '10px 0 0 0', { borderLeft: line, borderTop: line })}
      {corner({ right: out, top: out }, '0 10px 0 0', { borderRight: line, borderTop: line })}
      {corner({ left: out, bottom: out }, '0 0 0 10px', { borderLeft: line, borderBottom: line })}
      {corner({ right: out, bottom: out }, '0 0 10px 0', { borderRight: line, borderBottom: line })}
    </>
  );
};

const Grip = () => (
  <svg width={10} height={18} viewBox="0 0 10 18">
    {[0, 1, 2].map((r) => [0, 1].map((c) => <circle key={`${r}${c}`} cx={2 + c * 6} cy={3 + r * 6} r={1.4} fill={C.muted} />))}
  </svg>
);

const IconBox = ({ children, active = false }: { children: ReactNode; active?: boolean }) => (
  <div
    style={{
      height: 34,
      minWidth: 40,
      padding: '0 6px',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      color: active ? C.tealLight : C.muted,
      background: active ? 'rgba(94,234,212,.14)' : 'transparent',
      fontSize: 20,
      fontWeight: 500,
    }}
  >
    {children}
  </div>
);

const Drop = () => (
  <svg width={16} height={20} viewBox="0 0 16 20" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M8 2C8 2 2.5 8.6 2.5 12.5a5.5 5.5 0 0 0 11 0C13.5 8.6 8 2 8 2z" />
  </svg>
);

const PanelIcon = () => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
    <rect x={3} y={4} width={18} height={16} rx={2.5} />
    <line x1={9} y1={4} x2={9} y2={20} />
  </svg>
);

const HeaderIcons = ({ hoverSidebar }: { hoverSidebar: boolean }) => (
  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
    <IconBox>T+</IconBox>
    <IconBox>T−</IconBox>
    <IconBox>
      <Drop />+
    </IconBox>
    <IconBox>
      <Drop />−
    </IconBox>
    <IconBox>
      <svg width={20} height={22} viewBox="0 0 20 22" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M2 5h16M7 5V3h6v2M4 5l1 15h10l1-15M8 9v8M12 9v8" />
      </svg>
    </IconBox>
    <IconBox active={hoverSidebar}>
      <PanelIcon />
    </IconBox>
  </div>
);

// Chrome's native side panel showing the extension's caption history.
const SidePanel = ({ copy, width, offset }: { copy: Copy; width: number; offset: number }) => {
  const lines = timedLines(copy);
  return (
    <div
      style={{
        position: 'absolute',
        top: TAB_H + BAR_H,
        right: -offset,
        bottom: 0,
        width,
        background: '#14161c',
        borderLeft: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', color: C.muted }}>
        <Img src={staticFile('icon.png')} style={{ width: 22, height: 22, borderRadius: 5 }} />
        <div style={{ flex: 1, fontSize: 17, fontWeight: 600 }}>{copy.panelTitle}</div>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7M4 4l16 16" />
        </svg>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </div>
      <div
        style={{
          flex: 1,
          margin: '0 10px 10px',
          borderRadius: 12,
          background: C.bg,
          border: `1px solid ${C.surface2}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '16px 18px',
            borderBottom: `1px solid ${C.surface2}`,
            background: C.surface,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ color: C.tealLight, fontSize: 13, fontWeight: 800, letterSpacing: '0.14em' }}>LIVE CAPTIONS</div>
            <div style={{ fontSize: 21, fontWeight: 700, marginTop: 2 }}>{copy.historyTitle}</div>
          </div>
          {['T+', 'T−'].map((label) => (
            <div
              key={label}
              style={{
                width: 46,
                height: 42,
                marginLeft: 10,
                borderRadius: 10,
                border: `1.5px solid ${C.teal}`,
                color: C.tealLight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
                fontWeight: 700,
              }}
            >
              {label}
            </div>
          ))}
        </div>
        {/* Pinned to the newest caption; older ones scroll off the top. */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 22, right: 22, bottom: 18 }}>
            {lines.map((line, i) => (
              <PanelPair key={line.source} line={line} first={i === 0} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const PanelPair = ({ line, first }: { line: TimedLine; first: boolean }) => {
  const r = useReveal(line);
  if (!r.visible) return null;
  return (
    <div style={{ padding: '16px 0', borderTop: first ? 'none' : `1px solid ${C.surface2}` }}>
      <div style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.35, color: C.text }}>{r.source}</div>
      <div style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.35, color: C.amber, opacity: r.translation }}>
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
    [T.cursorToSidebar, REST, SIDEBAR_BTN],
    [[T.sidebarClick + 10, T.sidebarClick + 40], SIDEBAR_BTN, REST_LEFT],
  ];
  let pos = REST;
  for (const [[a, b], from, to] of path) {
    if (frame >= a) {
      const p = interpolate(frame, [a, b], [0, 1], { ...clamp, easing: ease });
      pos = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
    }
  }
  const visible = interpolate(frame, [80, 92], [0, 1], clamp);
  const clicks: [number, Point][] = [
    [T.iconClick, ICON],
    [T.startClick, START_BTN],
    [T.sidebarClick, SIDEBAR_BTN],
  ];

  return (
    <>
      {clicks.map(([at, target]) => (
        <Ripple key={at} at={at} target={target} />
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

const Ripple = ({ at, target }: { at: number; target: Point }) => {
  const frame = useCurrentFrame();
  if (frame < at || frame > at + 18) return null;
  const p = (frame - at) / 18;
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
