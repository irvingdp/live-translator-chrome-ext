export const OVERLAY_LAYOUTS_KEY = 'overlayLayoutsByOrigin';
export const OVERLAY_LAYOUT_STORE_VERSION = 1;
export const MAX_SAVED_ORIGINS = 100;

export type CaptionSurface = 'floating' | 'native';
export type OverlayPlacement = 'video-bottom';

export interface FloatingRect {
  heightRatio: number;
  widthRatio: number;
  xRatio: number;
  yRatio: number;
}

export interface OverlayLayout {
  floatingRect: FloatingRect;
  mode: CaptionSurface;
  version: 1;
}

export interface OverlayLayoutStore {
  layouts: Record<string, OverlayLayout>;
  order: string[];
  version: 1;
}

export const DEFAULT_FLOATING_RECT: FloatingRect = {
  heightRatio: 0.2,
  widthRatio: 0.7,
  xRatio: 0.15,
  yRatio: 0.72,
};

export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  floatingRect: DEFAULT_FLOATING_RECT,
  mode: 'floating',
  version: OVERLAY_LAYOUT_STORE_VERSION,
};

function finiteRatio(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function normalizeOverlayLayout(raw: unknown): OverlayLayout {
  const value = raw && typeof raw === 'object'
    ? raw as Partial<OverlayLayout>
    : {};
  const rect = value.floatingRect && typeof value.floatingRect === 'object'
    ? value.floatingRect as Partial<FloatingRect>
    : {};
  const widthRatio = Math.max(
    0.05,
    finiteRatio(rect.widthRatio, DEFAULT_FLOATING_RECT.widthRatio),
  );
  const heightRatio = Math.max(
    0.05,
    finiteRatio(rect.heightRatio, DEFAULT_FLOATING_RECT.heightRatio),
  );
  return {
    floatingRect: {
      heightRatio,
      widthRatio,
      xRatio: Math.min(
        1 - widthRatio,
        finiteRatio(rect.xRatio, DEFAULT_FLOATING_RECT.xRatio),
      ),
      yRatio: Math.min(
        1 - heightRatio,
        finiteRatio(rect.yRatio, DEFAULT_FLOATING_RECT.yRatio),
      ),
    },
    mode: value.mode === 'native' ? 'native' : 'floating',
    version: OVERLAY_LAYOUT_STORE_VERSION,
  };
}

export function normalizeOverlayLayoutStore(raw: unknown): OverlayLayoutStore {
  const value = raw && typeof raw === 'object'
    ? raw as Partial<OverlayLayoutStore>
    : {};
  const rawLayouts = value.layouts && typeof value.layouts === 'object'
    ? value.layouts
    : {};
  const layouts: Record<string, OverlayLayout> = {};
  for (const [origin, layout] of Object.entries(rawLayouts)) {
    if (!isHttpsOrigin(origin)) continue;
    layouts[origin] = normalizeOverlayLayout(layout);
  }
  const listed = Array.isArray(value.order)
    ? value.order.filter(
        (origin): origin is string =>
          typeof origin === 'string' && origin in layouts,
      )
    : [];
  const ordered = [...new Set(listed)];
  const missing = Object.keys(layouts).filter((origin) => !ordered.includes(origin));
  const order = [...ordered, ...missing].slice(-MAX_SAVED_ORIGINS);
  const retainedLayouts = Object.fromEntries(
    order.map((origin) => [origin, layouts[origin]!]),
  );
  return {
    layouts: retainedLayouts,
    order,
    version: OVERLAY_LAYOUT_STORE_VERSION,
  };
}

export function layoutForOrigin(
  rawStore: unknown,
  origin: string,
): OverlayLayout | undefined {
  if (!isHttpsOrigin(origin)) return undefined;
  return normalizeOverlayLayoutStore(rawStore).layouts[origin];
}

export function saveLayoutForOrigin(
  rawStore: unknown,
  origin: string,
  rawLayout: unknown,
): OverlayLayoutStore {
  const store = normalizeOverlayLayoutStore(rawStore);
  if (!isHttpsOrigin(origin)) return store;
  const order = store.order.filter((item) => item !== origin);
  order.push(origin);
  const layouts = {
    ...store.layouts,
    [origin]: normalizeOverlayLayout(rawLayout),
  };
  while (order.length > MAX_SAVED_ORIGINS) {
    const removed = order.shift();
    if (removed) delete layouts[removed];
  }
  return { layouts, order, version: OVERLAY_LAYOUT_STORE_VERSION };
}

export function httpsOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

function isHttpsOrigin(origin: string): boolean {
  return httpsOrigin(origin) === origin;
}
