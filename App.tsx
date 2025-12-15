import React, { useState, useRef, useEffect } from 'react';
import { AppState, TranscriptSegment } from './types';
import { ResultCard } from './components/ResultCard';
import { transcribeAudioToUrdu, summarizeUrduContent } from './services/geminiService';
import { initBackend, subscribeToRoomRealtime, sendMessageToRoom, deleteMessageFromRoom, getRoomMessages, deleteAllMessagesInRoom } from './services/firebase';

// --- HARDCODED CONFIGURATION ---
const SUPABASE_URL = "https://sumrhqfugbwzquzjlbdv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1bXJocWZ1Z2J3enF1empsYmR2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDgxNzA3OCwiZXhwIjoyMDgwMzkzMDc4fQ.RQNjWzqjE1y4_rS0ENNvKcd1vw8OJpu-4zLefOhQg5g";

const App: React.FC = () => {
  // --- STATE ---
  
  // 1. Identity & Room State
  const [username, setUsername] = useState<string>("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  // 2. Form State (Join Screen)
  const [tempName, setTempName] = useState("");
  const [tempRoomId, setTempRoomId] = useState("1234"); // Default 1234

  // 3. App Functionality State
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [summary, setSummary] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false); // New state to track clearing status

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recordingMimeTypeRef = useRef<string>("");

  // --- EFFECTS ---

  // Initialize Backend on Load
  useEffect(() => {
    initBackend(SUPABASE_URL, SUPABASE_KEY);
    
    // Attempt to recover name from local storage safely
    try {
      const stored = localStorage.getItem('urdu_voice_user');
      if (stored) setTempName(stored);
    } catch (e) {
      console.warn("Local storage disabled");
    }

    // Check URL
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
        setTempRoomId(roomParam);
    }
  }, []);

  // Room Subscription: Sync messages AND Presence
  useEffect(() => {
    if (hasJoined && roomId && username) {
        setOnlineUsers([username]); // Immediate feedback

        const unsubscribe = subscribeToRoomRealtime(roomId, username, {
            onHistory: (history) => {
                // Only update if we are not currently clearing the chat
                if (!isClearing) {
                    setSegments(history);
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                }
            },
            onNewSegment: (segment) => {
                if (!isClearing) {
                    setSegments(prev => {
                        // Deduplicate
                        if (prev.find(s => s.id === segment.id)) return prev;
                        return [...prev, segment];
                    });
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                }
            },
            onPresenceUpdate: (users) => {
                setOnlineUsers(users);
            }
        });

        return () => {
            unsubscribe();
        };
    }
  }, [hasJoined, roomId, username, isClearing]);

  // Automatic Refresh Polling (Every 2 seconds)
  useEffect(() => {
    // Don't poll if not joined, no room, OR IF CLEARING IS IN PROGRESS
    if (!hasJoined || !roomId || isClearing) return;

    const pollInterval = setInterval(async () => {
      try {
        const latestSegments = await getRoomMessages(roomId);
        // Double check isClearing inside the callback to be safe
        setSegments(prev => {
           if (isClearing) return []; // If clearing started during poll, prefer empty
           // Deep compare to avoid unnecessary re-renders/scrolls if data is identical
           if (JSON.stringify(latestSegments) !== JSON.stringify(prev)) {
             return latestSegments;
           }
           return prev;
        });
      } catch (err) {
        console.warn("Polling failed silently", err);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [hasJoined, roomId, isClearing]); // Add isClearing dependency

  // Auto-scroll on state change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments, summary, appState]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Clear error after 3 seconds
  useEffect(() => {
    if (errorMsg) {
      const timer = setTimeout(() => setErrorMsg(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMsg]);

  // --- HANDLERS ---

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (tempName.trim() && tempRoomId.trim()) {
      const finalName = tempName.trim();
      const finalRoom = tempRoomId.trim();

      // 1. Set State
      setUsername(finalName);
      setRoomId(finalRoom);
      
      // 2. Try to save to local storage (fails safely if disabled)
      try {
        localStorage.setItem('urdu_voice_user', finalName);
      } catch (err) {
        console.warn("Could not save to localStorage", err);
      }
      
      // 3. Update URL without reload to reflect current room
      try {
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + finalRoom;
        window.history.pushState({path:newUrl},'',newUrl);
      } catch (err) {
        console.warn("Could not update URL", err);
      }
      
      // 4. Trigger UI switch
      setHasJoined(true);
    }
  };

  const leaveMeeting = () => {
     if(window.confirm("Leave meeting?")) {
       setHasJoined(false);
       setRoomId(null);
       setOnlineUsers([]);
       try {
         window.history.pushState({}, '', window.location.pathname);
       } catch (e) {}
     }
  };

  const initRecording = async () => {
    try {
      setErrorMsg(null);
      
      // Stop previous streams if any
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Determine best supported mime type
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4', // Safari
        'audio/ogg;codecs=opus',
        '' // Default fallback
      ];
      
      let selectedMimeType = '';
      for (const type of mimeTypes) {
        if (type === '' || MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }
      
      recordingMimeTypeRef.current = selectedMimeType;
      console.log("Recording with MIME:", selectedMimeType || "default");

      const options = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setAppState(AppState.RECORDING);
    } catch (err) {
      console.error("Microphone error:", err);
      setErrorMsg("Could not access microphone. Check permissions.");
      setAppState(AppState.ERROR);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setAppState(AppState.PAUSED);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setAppState(AppState.RECORDING);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      audioChunksRef.current = [];
      setAppState(AppState.IDLE);
    }
  };

  const restartRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      audioChunksRef.current = [];
    }
    setAppState(AppState.IDLE);
    setTimeout(() => {
      initRecording();
    }, 150);
  };

  const stopAndProcess = () => {
    if (!mediaRecorderRef.current) return;
    setAppState(AppState.PROCESSING);

    // Ensure we capture the 'stop' event to get final data
    new Promise<void>((resolve) => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = () => resolve();
        mediaRecorderRef.current.stop();
      } else {
        resolve();
      }
    }).then(() => {
      // Create blob using the same mime type we initialized with
      const mimeType = recordingMimeTypeRef.current || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      
      if (audioBlob.size === 0) {
        setErrorMsg("Recording was empty. Try again.");
        setAppState(AppState.IDLE);
        return;
      }
      
      processAudio(audioBlob);
    });
  };

  const processAudio = async (audioBlob: Blob) => {
    try {
      console.log("Processing audio blob:", audioBlob.type, audioBlob.size);
      
      const text = await transcribeAudioToUrdu(audioBlob);
      if (roomId && username) {
          const savedData = await sendMessageToRoom(roomId, text, username);
          
          // Optimistically update the UI to show the message immediately
          if (savedData) {
              const newSegment: TranscriptSegment = {
                  id: savedData.id.toString(),
                  text: savedData.text,
                  author: savedData.author,
                  timestamp: new Date(savedData.created_at).getTime()
              };
              setSegments(prev => {
                  // Prevent duplicate if realtime subscription already updated it
                  if (prev.find(s => s.id === newSegment.id)) return prev;
                  return [...prev, newSegment];
              });
              setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
          }
      }
      setAppState(AppState.IDLE);
    } catch (err: any) {
      console.error("Process Audio Error:", err);
      setErrorMsg(err.message || "Transcription failed. Please try again.");
      setAppState(AppState.IDLE);
    }
  };

  const handleSummarize = async () => {
    if (segments.length === 0) return;
    setAppState(AppState.PROCESSING);
    try {
      const textArray = segments.map(s => `${s.author}: ${s.text}`);
      const summaryText = await summarizeUrduContent(textArray);
      setSummary(summaryText);
    } catch (err) {
      setErrorMsg("Summarization failed.");
    } finally {
      setAppState(AppState.IDLE);
    }
  };

  const handleDeleteSegment = async (id: string) => {
    if (window.confirm("Delete this message for everyone?")) {
        await deleteMessageFromRoom(id);
    }
  };

  const handleClearAll = async () => {
    if (!roomId) return;
    
    if (window.confirm("⚠️ Are you sure you want to delete ALL messages in this room? This cannot be undone.")) {
        setIsClearing(true); // Stop polling interactions
        try {
            await deleteAllMessagesInRoom(roomId);
            // Force clear state immediately
            setSegments([]);
            setSummary(null);
            console.log("Room cleared successfully.");
        } catch(e) {
            console.error(e);
            setErrorMsg("Failed to clear history. Please try again.");
        } finally {
            // Keep isClearing true for a small buffer to let realtime events settle, 
            // or reset immediately. Resetting immediately is fine if await finished.
            setIsClearing(false);
        }
    }
  };

  const handleShareLink = () => {
      const url = window.location.href;
      if (navigator.share) {
          navigator.share({
              title: 'Join my Voice Chat',
              url: url
          });
      } else {
          navigator.clipboard.writeText(url);
          alert("Meeting link copied to clipboard!");
      }
  };

  const handleExport = async () => {
    const allText = segments.map(s => `[${new Date(s.timestamp).toLocaleTimeString()}] ${s.author}:\n${s.text}`).join('\n\n');
    const fullContent = summary 
      ? `--- 📝 SUMMARY ---\n${summary}\n\n--- 💬 CHAT ---\n${allText}`
      : allText;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Urdu Chat Transcript',
          text: fullContent,
        });
      } catch (err) {
        console.log('Share cancelled', err);
      }
    } else {
      navigator.clipboard.writeText(fullContent);
      alert("Copied to clipboard!");
    }
  };

  const isProcessing = appState === AppState.PROCESSING;
  const isRecording = appState === AppState.RECORDING;
  const isPaused = appState === AppState.PAUSED;

  // --- RENDER 1: JOIN SCREEN ---
  if (!hasJoined) {
    return (
      <div className="flex flex-col h-screen bg-slate-50 items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 text-center animate-fade-in-up">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">
            Urdu Voice Chat
          </h1>
          <p className="text-slate-500 mb-6">Enter meeting details to join.</p>
          
          <form onSubmit={handleJoinSubmit} className="space-y-4">
            <div className="text-left">
              <label className="block text-xs font-bold text-slate-600 mb-1 ml-1">Meeting ID</label>
              <input 
                type="text" 
                placeholder="e.g. 1234"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-lg font-mono"
                value={tempRoomId}
                onChange={(e) => setTempRoomId(e.target.value)}
                required
              />
            </div>
            
            <div className="text-left">
              <label className="block text-xs font-bold text-slate-600 mb-1 ml-1">Your Name</label>
              <input 
                type="text" 
                placeholder="Enter your name"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-lg"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                required
              />
            </div>

            <button 
              type="submit"
              className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 active:bg-emerald-800 transition-colors shadow-lg mt-2 flex justify-center items-center"
            >
              Join Meeting
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- RENDER 2: MAIN APP (CHAT) ---
  return (
    <div className="flex flex-col h-screen bg-[#e5ddd5] font-sans overflow-hidden relative">
      {/* Background Pattern Overlay */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4a5568 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

      {/* Header */}
      <header className="flex-none bg-emerald-700 shadow-md p-3 z-10 text-white">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center border border-emerald-500 relative">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight flex items-center gap-2">
                Room: {roomId}
              </h1>
              <div className="text-xs text-emerald-200">
                Logged in as <span className="font-semibold text-white">{username}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
                onClick={handleShareLink}
                className="p-2 bg-emerald-800/50 hover:bg-emerald-600 rounded-full transition-colors"
                title="Invite Others"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
            </button>
             <button 
                onClick={leaveMeeting}
                className="p-2 hover:bg-emerald-600 rounded-full transition-colors"
                title="Leave"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
          </div>
        </div>
      </header>

      {/* Online Users Bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto shadow-sm z-10">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex-none">Online:</span>
        <div className="flex gap-2">
          {onlineUsers.map((user, idx) => (
            <div key={`${user}-${idx}`} className="flex items-center gap-1.5 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-xs font-semibold text-emerald-800 whitespace-nowrap">{user}</span>
            </div>
          ))}
          {onlineUsers.length === 0 && (
             <span className="text-xs text-slate-400 italic">Connecting...</span>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 pb-48 z-0">
        <div className="max-w-md mx-auto">
          
          {segments.length === 0 && !summary && (
            <div className="text-center py-8 opacity-60">
              <div className="bg-white/50 inline-block px-4 py-2 rounded-lg text-sm text-slate-600 shadow-sm">
                {isClearing ? "Clearing chat..." : "Waiting for someone to speak..."}
              </div>
            </div>
          )}

          {/* Summary */}
          {summary && (
            <ResultCard text={summary} type="SUMMARY" onDelete={() => setSummary(null)} />
          )}

          {/* Chat Messages */}
          {segments.map((segment) => (
            <ResultCard 
              key={segment.id} 
              text={segment.text} 
              type="TRANSCRIPT"
              author={segment.author}
              timestamp={segment.timestamp}
              onDelete={() => handleDeleteSegment(segment.id)}
            />
          ))}

          {isProcessing && (
             <div className="flex justify-end mb-4 animate-fade-in-up">
                <div className="bg-white rounded-2xl rounded-tr-none px-4 py-3 shadow-sm flex items-center gap-3">
                   <div className="flex gap-1">
                     <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                     <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                     <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                   </div>
                   <span className="text-xs text-slate-500 font-medium">Transcribing...</span>
                </div>
             </div>
          )}
          
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Error Toast */}
      {errorMsg && (
        <div className="absolute bottom-40 left-0 right-0 flex justify-center z-50 px-4 animate-fade-in-up">
           <div className="bg-red-500 text-white text-sm py-2 px-4 rounded-full shadow-lg flex items-center gap-2">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
             {errorMsg}
           </div>
        </div>
      )}

      {/* Footer Controls */}
      <footer className="flex-none bg-[#f0f2f5] border-t border-slate-200 p-3 pb-6 safe-area-pb z-20">
        <div className="max-w-md mx-auto space-y-3">
          
          {/* Action Buttons */}
          {(segments.length > 0) && !isRecording && !isPaused && !isProcessing && (
            <div className="flex gap-2 justify-center mb-1">
              <button onClick={handleSummarize} className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-full text-slate-600 font-medium hover:bg-slate-50">
                 ✨ Summarize
              </button>
              <button onClick={handleExport} className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-full text-slate-600 font-medium hover:bg-slate-50">
                 📤 Export
              </button>
              <button 
                onClick={handleClearAll} 
                disabled={isClearing}
                className={`text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-full text-red-600 font-medium hover:bg-red-50 ${isClearing ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                 {isClearing ? '🗑️ Clearing...' : '🗑️ Clear All'}
              </button>
            </div>
          )}

          {/* Mic Controls */}
          <div className="flex items-center justify-between bg-white rounded-full shadow-sm p-1 pr-2 border border-slate-200">
            
            {/* Left Status Area */}
            <div className="flex-1 pl-4">
               <p className="text-sm text-slate-500 truncate font-medium">
                 {isRecording ? "Recording..." : isPaused ? "Paused" : isProcessing ? "Just a moment..." : "Tap mic to speak"}
               </p>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              
              {(isRecording || isPaused) && (
                <>
                  <button onClick={cancelRecording} className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                  <button onClick={restartRecording} className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:bg-blue-50 hover:text-blue-500 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                </>
              )}

              {/* Main Mic Button */}
              {isRecording ? (
                <button onClick={pauseRecording} className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center text-white shadow-md animate-pulse">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                </button>
              ) : isPaused ? (
                <button onClick={resumeRecording} className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center text-white shadow-md">
                   <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
              ) : isProcessing ? (
                <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center">
                   <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <button onClick={initRecording} className="w-12 h-12 bg-emerald-600 rounded-full flex items-center justify-center text-white shadow-md hover:bg-emerald-700 transition-transform active:scale-95">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                </button>
              )}

              {/* Send/Stop Button */}
              {(isRecording || isPaused) && (
                 <button onClick={stopAndProcess} className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-md hover:bg-emerald-600 transition-transform active:scale-95">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                 </button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;