import { MessageCircle, Search, User, MapPin, Plus, Sparkles } from 'lucide-react';

export default function RightRail() {
  return (
    <aside className="flex w-12 flex-shrink-0 flex-col items-center gap-2 border-l border-gdoc-border bg-white py-3">
      <RailBtn title="Ask Gemini" badge>
        <Sparkles size={18} />
      </RailBtn>
      <RailBtn title="Chat"><MessageCircle size={18} /></RailBtn>
      <RailBtn title="Search"><Search size={18} /></RailBtn>
      <RailBtn title="Contacts"><User size={18} /></RailBtn>
      <RailBtn title="Maps"><MapPin size={18} /></RailBtn>
      <div className="flex-1" />
      <RailBtn title="More"><Plus size={18} /></RailBtn>
    </aside>
  );
}

function RailBtn({ children, title, badge }: { children: React.ReactNode; title: string; badge?: boolean }) {
  return (
    <button
      title={title}
      className="relative grid h-8 w-8 place-items-center rounded-full text-[#1a73e8] hover:bg-gdoc-active"
    >
      {children}
      {badge && (
        <span className="absolute -right-0.5 -top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-amber-400 text-[8px] font-bold text-white">
          ✦
        </span>
      )}
    </button>
  );
}
