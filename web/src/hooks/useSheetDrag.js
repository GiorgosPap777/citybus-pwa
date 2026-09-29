import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Past this, a drag is a request to collapse or expand; under TAP_SLOP it is a tap.
const DRAG_THRESHOLD_PX = 40;
const TAP_SLOP_PX = 6;
const RESIZE_MS = 240;

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The sheet's collapsed state, with the change animated.
 *
 * Collapsing or expanding swaps the sheet's content, so its height changed in a
 * single frame and the sheet popped into place. `setCollapsed` notes where the
 * top edge is at that moment (a drag offset included); once the new content is
 * laid out, the height is animated from there to its natural size. Height rather
 * than transform: the sheet is anchored to the bottom, so translating a shrinking
 * sheet would open a gap beneath it.
 */
export function useSheetCollapse(sheetRef) {
  const [collapsed, setState] = useState(false);
  const fromTop = useRef(null);
  const settle = useRef(0);

  const setCollapsed = useCallback(
    (next) => {
      const el = sheetRef.current;
      fromTop.current = el ? el.getBoundingClientRect().top : null;
      setState(next);
    },
    [sheetRef],
  );

  useLayoutEffect(() => {
    const el = sheetRef.current;
    const from = fromTop.current;
    fromTop.current = null;
    if (!el || from === null) return;

    clearTimeout(settle.current);
    const style = el.style;
    const done = () => {
      style.transition = '';
      style.height = '';
      style.overflowY = '';
      delete el.dataset.restHeight;
    };

    // Drop any drag offset and unfinished animation without animating that
    // itself; reading the rect applies the change before transitions come back.
    style.transition = 'none';
    style.transform = '';
    style.height = '';
    style.overflowY = '';
    const { bottom, height: to } = el.getBoundingClientRect();
    const start = bottom - from;
    if (Math.abs(to - start) < 2 || prefersReducedMotion()) {
      done();
      return;
    }

    // The map frames what it shows against the sheet's height; this is the height
    // it is heading for, not the one it has mid-animation.
    el.dataset.restHeight = String(to);
    style.overflowY = 'hidden';
    style.height = `${start}px`;
    el.getBoundingClientRect();
    style.transition = `height ${RESIZE_MS}ms ease-out`;
    style.height = `${to}px`;
    settle.current = setTimeout(done, RESIZE_MS + 50);
  }, [collapsed, sheetRef]);

  useEffect(() => () => clearTimeout(settle.current), []);

  return [collapsed, setCollapsed];
}

/**
 * Makes the bottom sheet collapsible: drag its grip down to shrink it to a peek,
 * up to restore it, or tap to toggle. Returns props to spread on every element
 * that acts as a grip (the handle bar, and a sheet's header).
 *
 * The sheet follows the finger only on the way down. It is anchored to the bottom
 * edge, so following an upward drag would open a gap beneath it.
 */
export function useSheetDrag(sheetRef, collapsed, setCollapsed) {
  const gesture = useRef(null);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Buttons inside a grip (star, close) keep their own taps.
    if (e.target.closest('button:not(.sheet-handle), input, select, a')) return;
    gesture.current = { id: e.pointerId, startY: e.clientY, dy: 0, onHandle: !!e.target.closest('.sheet-handle') };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e) => {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      g.dy = e.clientY - g.startY;
      const sheet = sheetRef.current;
      if (sheet && !collapsed && g.dy > TAP_SLOP_PX) {
        sheet.classList.add('dragging');
        sheet.style.transform = `translateY(${g.dy}px)`;
      }
    },
    [sheetRef, collapsed],
  );

  const onPointerUp = useCallback(
    (e) => {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      gesture.current = null;
      const sheet = sheetRef.current;

      let next = null;
      if (e.type === 'pointercancel') {
        // Nothing to decide; just put the sheet back.
      } else if (Math.abs(g.dy) <= TAP_SLOP_PX) {
        // A collapsed sheet opens from a tap anywhere on its grip; an open one
        // closes only from the handle, so tapping a title does nothing surprising.
        if (collapsed || g.onHandle) next = !collapsed;
      } else if (!collapsed && g.dy > DRAG_THRESHOLD_PX) {
        next = true;
      } else if (collapsed && g.dy < -DRAG_THRESHOLD_PX / 2) {
        next = false;
      }

      sheet?.classList.remove('dragging');
      if (next === null) {
        // Snap back; the CSS transition animates it.
        if (sheet) sheet.style.transform = '';
      } else {
        // The drag offset stays until useSheetCollapse has measured it, so the
        // resize starts where the finger let go instead of jumping back first.
        setCollapsed(next);
      }
    },
    [sheetRef, collapsed, setCollapsed],
  );

  // Pointer taps are handled above; this covers Enter/Space on the handle, whose
  // click event carries detail 0.
  const onHandleClick = useCallback(
    (e) => {
      if (e.detail === 0) setCollapsed(!collapsed);
    },
    [collapsed, setCollapsed],
  );

  return {
    gripProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    onHandleClick,
  };
}
