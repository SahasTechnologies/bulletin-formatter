import { useEffect, useState } from 'react';
import MenuBar from './components/MenuBar';
import Toolbar from './components/Toolbar';
import LeftSidebar from './components/LeftSidebar';
import RightRail from './components/RightRail';
import DocumentCanvas from './components/DocumentCanvas';
import { GoogleFontProvider } from './components/GoogleFontProvider';

export interface DocumentSettings {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textColor: string;
  highlight: string;
  align: 'left' | 'center' | 'right' | 'justify';
}

const initialSettings: DocumentSettings = {
  font: 'Arial',
  size: 11,
  bold: false,
  italic: false,
  underline: false,
  textColor: '#000000',
  highlight: 'transparent',
  align: 'left',
};

export default function App() {
  const [settings, setSettings] = useState<DocumentSettings>(initialSettings);
  const [zoom, setZoom] = useState(100);
  const [leftOpen, setLeftOpen] = useState(true);
  const [documentTitle, setDocumentTitle] = useState('Untitled document');
  const [starred, setStarred] = useState(false);
  const [style, setStyle] = useState('Normal text');

  // Cmd/Ctrl+S quick-save shim
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // would open a save dialog in a fuller app
        console.log('Save (demo):', documentTitle);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [documentTitle]);

  return (
    <GoogleFontProvider>
      <div className="flex h-full w-full flex-col bg-gdoc-bg text-[#202124]">
        <MenuBar
          title={documentTitle}
          starred={starred}
          onTitleChange={setDocumentTitle}
          onToggleStar={() => setStarred((s) => !s)}
        />
        <Toolbar
          settings={settings}
          setSettings={setSettings}
          zoom={zoom}
          setZoom={setZoom}
          style={style}
          setStyle={setStyle}
        />
        <div className="flex flex-1 overflow-hidden">
          <LeftSidebar open={leftOpen} onClose={() => setLeftOpen(false)} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <DocumentCanvas settings={settings} />
            <div className="flex-shrink-0 border-t border-gdoc-border bg-white px-3 py-1.5 text-xs text-gdoc-muted">
              Page 1 of 1 &nbsp;·&nbsp; {Math.round(settings.size * zoom / 100 * 100) / 100}pt &nbsp;·&nbsp; {style}
            </div>
          </div>
          <RightRail />
        </div>
      </div>
    </GoogleFontProvider>
  );
}
