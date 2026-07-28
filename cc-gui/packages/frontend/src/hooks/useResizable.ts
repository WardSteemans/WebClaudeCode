import { useState, useCallback, useEffect, useRef } from 'react';

export function useResizable(initialWidth: number, minWidth = 120, maxWidth = 800, invert = false) {
  const [width, setWidth] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const savedWidth = useRef(initialWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const applyWidth = useCallback((w: number) => {
    if (panelRef.current) {
      panelRef.current.style.width = `${w}px`;
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = panelRef.current ? parseInt(panelRef.current.style.width || String(width), 10) : width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = invert ? startX.current - e.clientX : e.clientX - startX.current;
      const next = Math.min(maxWidth, Math.max(minWidth, startW.current + delta));
      applyWidth(next);
      if (collapsed && next > minWidth + 10) setCollapsed(false);
      if (!collapsed && next <= minWidth) setCollapsed(true);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const final = panelRef.current ? parseInt(panelRef.current.style.width, 10) : width;
      if (final > minWidth) {
        setWidth(final);
        savedWidth.current = final;
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [collapsed, minWidth, maxWidth, invert, applyWidth, width]);

  const toggle = useCallback(() => {
    if (collapsed) {
      setCollapsed(false);
      setWidth(savedWidth.current);
      applyWidth(savedWidth.current);
    } else {
      savedWidth.current = width;
      setCollapsed(true);
      setWidth(0);
      applyWidth(0);
    }
  }, [collapsed, width, applyWidth]);

  const effectiveWidth = collapsed ? 0 : width;

  return { width: effectiveWidth, collapsed, onMouseDown, toggle, panelRef };
}
