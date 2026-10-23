import { useEffect, useState } from 'react';
import { navigationMenu, navigationMode, subscribeCommandUi } from '../commands/runtime';
import { closeNavMenu, navDrag, openNavMenu, subscribeNavUi, useNavMenu } from '../view/navUi';

export function NavMenu() {
  const menu = useNavMenu();
  useEffect(() => {
    const onMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (!detail) return;
      openNavMenu(detail.x, detail.y);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.button === 2) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.nav-menu')) return;
      closeNavMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') closeNavMenu();
    };
    window.addEventListener('fieldline-nav-menu', onMenu);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('fieldline-nav-menu', onMenu);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  if (!menu) return null;
  return (
    <div className="nav-menu" role="menu" style={{ left: menu.x, top: menu.y }} data-nav-menu="open">
      {menu.items.map((item) => (
        <button
          key={item}
          type="button"
          role="menuitem"
          onClick={() => {
            closeNavMenu();
            navigationMenu(item);
          }}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function NavCursor() {
  const [cursor, setCursor] = useState<{ x: number; y: number; kind: 'grab' | 'grabbing' | 'zoom' } | null>(null);
  useEffect(() => {
    let frame = 0;
    let x = 0;
    let y = 0;
    let seen = false;
    const paint = () => {
      frame = 0;
      const mode = navigationMode();
      const pulling = navDrag();
      if (!seen || (!pulling && mode !== 'pan' && mode !== 'zoom')) {
        setCursor(null);
        return;
      }
      const kind = pulling === 'zoom' || mode === 'zoom' ? 'zoom' : pulling === 'pan' ? 'grabbing' : 'grab';
      setCursor({ x, y, kind });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      seen = true;
      schedule();
    };
    const unsub = subscribeCommandUi(schedule);
    const unsubDrag = subscribeNavUi(schedule);
    window.addEventListener('pointermove', move);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      unsub();
      unsubDrag();
    };
  }, []);
  if (!cursor) return null;
  return (
    <div className="nav-cursor" data-nav-cursor="on" data-kind={cursor.kind} style={{ left: cursor.x, top: cursor.y }} aria-hidden="true">
      <HandIcon />
    </div>
  );
}

function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28">
      <path
        d="M8.2 10.2V5.6a1.4 1.4 0 0 1 2.8 0v4.2M11.2 9.4V4.8a1.4 1.4 0 0 1 2.8 0v5M14.2 10V6.2a1.4 1.4 0 0 1 2.8 0V13c0 3-2 5.2-5.2 5.2-2.6 0-4.3-1.4-5-3.2l-1.6-3.2a1.3 1.3 0 0 1 2.2-1.3l1 1.7"
        fill="#f4f7fb"
        stroke="#1b2430"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
