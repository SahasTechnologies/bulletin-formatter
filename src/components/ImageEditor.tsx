import { useEffect, useState, useRef } from 'react';
import { Settings } from 'lucide-react';

interface ImageEditorProps {
  image: HTMLImageElement;
  onUpdate: () => void;
}

export default function ImageEditor({ image, onUpdate }: ImageEditorProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [keepAspectRatio, setKeepAspectRatio] = useState(true);
  const [borderRadius, setBorderRadius] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [startSize, setStartSize] = useState({ width: 0, height: 0 });
  const [handle, setHandle] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Get initial border radius from image style
    const currentRadius = image.style.borderRadius || '0px';
    setBorderRadius(parseInt(currentRadius) || 0);
  }, [image]);

  useEffect(() => {
    // Apply border radius to image
    image.style.borderRadius = `${borderRadius}px`;
  }, [borderRadius, image]);

  const handleMouseDown = (e: React.MouseEvent, handlePosition: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(true);
    setHandle(handlePosition);
    setStartPos({ x: e.clientX, y: e.clientY });
    setStartSize({
      width: image.offsetWidth,
      height: image.offsetHeight,
    });
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!handle) return;

      const deltaX = e.clientX - startPos.x;
      const deltaY = e.clientY - startPos.y;

      let newWidth = startSize.width;
      let newHeight = startSize.height;

      // Calculate new dimensions based on handle position
      switch (handle) {
        case 'nw':
          newWidth = startSize.width - deltaX;
          newHeight = keepAspectRatio 
            ? (newWidth / startSize.width) * startSize.height 
            : startSize.height - deltaY;
          break;
        case 'n':
          newHeight = startSize.height - deltaY;
          if (keepAspectRatio) {
            newWidth = (newHeight / startSize.height) * startSize.width;
          }
          break;
        case 'ne':
          newWidth = startSize.width + deltaX;
          newHeight = keepAspectRatio 
            ? (newWidth / startSize.width) * startSize.height 
            : startSize.height - deltaY;
          break;
        case 'w':
          newWidth = startSize.width - deltaX;
          if (keepAspectRatio) {
            newHeight = (newWidth / startSize.width) * startSize.height;
          }
          break;
        case 'e':
          newWidth = startSize.width + deltaX;
          if (keepAspectRatio) {
            newHeight = (newWidth / startSize.width) * startSize.height;
          }
          break;
        case 'sw':
          newWidth = startSize.width - deltaX;
          newHeight = keepAspectRatio 
            ? (newWidth / startSize.width) * startSize.height 
            : startSize.height + deltaY;
          break;
        case 's':
          newHeight = startSize.height + deltaY;
          if (keepAspectRatio) {
            newWidth = (newHeight / startSize.height) * startSize.width;
          }
          break;
        case 'se':
          newWidth = startSize.width + deltaX;
          newHeight = keepAspectRatio 
            ? (newWidth / startSize.width) * startSize.height 
            : startSize.height + deltaY;
          break;
      }

      // Apply minimum size constraints
      newWidth = Math.max(50, newWidth);
      newHeight = Math.max(50, newHeight);

      image.style.width = `${newWidth}px`;
      image.style.height = `${newHeight}px`;
      onUpdate();
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setHandle(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handle, startPos, startSize, keepAspectRatio, image, onUpdate]);

  const handles = [
    { position: 'nw', cursor: 'nwse-resize', style: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2' },
    { position: 'n', cursor: 'ns-resize', style: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2' },
    { position: 'ne', cursor: 'nesw-resize', style: 'top-0 right-0 translate-x-1/2 -translate-y-1/2' },
    { position: 'w', cursor: 'ew-resize', style: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2' },
    { position: 'e', cursor: 'ew-resize', style: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2' },
    { position: 'sw', cursor: 'nesw-resize', style: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2' },
    { position: 's', cursor: 'ns-resize', style: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2' },
    { position: 'se', cursor: 'nwse-resize', style: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2' },
  ];

  return (
    <>
      <div
        ref={wrapperRef}
        className="absolute border-2 border-bb-500 pointer-events-none"
        style={{
          top: `${image.offsetTop}px`,
          left: `${image.offsetLeft}px`,
          width: `${image.offsetWidth}px`,
          height: `${image.offsetHeight}px`,
        }}
      >
        {/* Resize handles */}
        {handles.map(({ position, cursor, style }) => (
          <div
            key={position}
            className={`absolute w-3 h-3 bg-white border-2 border-bb-500 rounded-full pointer-events-auto ${style}`}
            style={{ cursor }}
            onMouseDown={(e) => handleMouseDown(e, position)}
          />
        ))}

        {/* Settings button */}
        <button
          className="absolute -top-8 right-0 flex items-center gap-1 bg-white border border-gdoc-border rounded px-2 py-1 text-[11px] text-gdoc-muted hover:bg-gdoc-hover pointer-events-auto"
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings size={12} />
          Settings
        </button>

        {/* Settings panel */}
        {showSettings && (
          <div className="absolute -top-32 right-0 bg-white border border-gdoc-border rounded shadow-lg p-3 w-48 pointer-events-auto z-50">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] text-gdoc-muted">Keep aspect ratio</label>
              <input
                type="checkbox"
                checked={keepAspectRatio}
                onChange={(e) => setKeepAspectRatio(e.target.checked)}
                className="w-4 h-4"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gdoc-muted">Border radius: {borderRadius}px</label>
              <input
                type="range"
                min="0"
                max="50"
                value={borderRadius}
                onChange={(e) => setBorderRadius(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
