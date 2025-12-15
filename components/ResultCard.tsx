import React from 'react';

interface ResultCardProps {
  text: string;
  type: 'TRANSCRIPT' | 'SUMMARY';
  author?: string;
  timestamp?: number;
  onDelete?: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ text, type, author, timestamp, onDelete }) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
  };

  const isSummary = type === 'SUMMARY';
  const timeString = timestamp 
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  if (isSummary) {
    return (
      <div className="flex justify-center my-6">
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 shadow-sm max-w-sm w-full mx-4">
           <div className="flex justify-between items-center mb-2 border-b border-amber-100 pb-2">
              <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">📝 AI Summary</span>
              <button onClick={onDelete} className="text-amber-400 hover:text-red-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
           </div>
           <p className="text-slate-800 text-right font-serif leading-loose text-sm" dir="rtl">{text}</p>
        </div>
      </div>
    );
  }

  // Chat Bubble Style
  return (
    <div className="flex flex-col items-end mb-4 animate-fade-in-up">
      <div className="bg-white border border-slate-200 rounded-2xl rounded-tr-none shadow-sm max-w-[85%] min-w-[120px] overflow-hidden">
        {/* Header with Name */}
        <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center gap-4">
           <span className="text-xs font-bold text-emerald-800 truncate max-w-[120px]">{author || 'Unknown'}</span>
           <div className="flex gap-2">
             <button onClick={handleCopy} className="text-[10px] font-medium text-emerald-600 uppercase">Copy</button>
             {onDelete && (
                <button onClick={onDelete} className="text-slate-300 hover:text-red-500">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
             )}
           </div>
        </div>
        
        {/* Message Body */}
        <div className="px-4 py-2 bg-emerald-50/30">
          <p className="text-lg text-slate-800 leading-loose font-serif text-right" dir="rtl">
            {text}
          </p>
        </div>

        {/* Timestamp Footer */}
        <div className="px-2 py-1 flex justify-end">
          <span className="text-[10px] text-slate-400">{timeString}</span>
        </div>
      </div>
    </div>
  );
};