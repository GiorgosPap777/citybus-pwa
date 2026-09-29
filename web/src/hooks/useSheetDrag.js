import { useCallback, useRef } from 'react';

// Past this, a drag is a request to collapse or expand; under TAP_SLOP it is a tap.
const DRAG_THRESHOLD_PX = 40;
const TAP_SLOP_PX = 6;

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
      if (sheet) {
        sheet.classList.remove('dragging');
        sheet.style.transform = '';
      }
      if (e.type === 'pointercancel') return;

      if (Math.abs(g.dy) <= TAP_SLOP_PX) {
        // A collapsed sheet opens from a tap anywhere on its grip; an open one
        // closes only from the handle, so tapping a title does nothing surprising.
        if (collapsed || g.onHandle) setCollapsed(!collapsed);
      } else if (!collapsed && g.dy > DRAG_THRESHOLD_PX) {
        setCollapsed(true);
      } else if (collapsed && g.dy < -DRAG_THRESHOLD_PX / 2) {
        setCollapsed(false);
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
