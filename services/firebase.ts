import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TranscriptSegment } from '../types';

let supabase: SupabaseClient | null = null;

export const isBackendInitialized = () => !!supabase;

export const initBackend = (url: string, key: string) => {
  try {
    if (!url || !key) return false;
    supabase = createClient(url, key, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    return true;
  } catch (e) {
    console.error("Supabase Init Error", e);
    return false;
  }
};

export const getRoomMessages = async (roomId: string): Promise<TranscriptSegment[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error("Error fetching messages:", error);
    return [];
  }

  return data ? data.map((d: any) => ({
    id: d.id.toString(),
    text: d.text,
    author: d.author,
    timestamp: new Date(d.created_at).getTime(),
  })) : [];
};

export const subscribeToRoomRealtime = (
  roomId: string, 
  username: string,
  callbacks: {
      onHistory: (segments: TranscriptSegment[]) => void;
      onNewSegment: (segment: TranscriptSegment) => void;
      onPresenceUpdate: (users: string[]) => void;
  }
) => {
  if (!supabase) return () => {};

  // 1. Initial Fetch of Chat History
  const fetchMessages = async () => {
    const segments = await getRoomMessages(roomId);
    callbacks.onHistory(segments);
  };

  fetchMessages();

  // 2. Subscribe to Realtime Events (Messages & Presence)
  // We use a single channel for both to ensure consistent connection
  const channel = supabase.channel(`room_realtime:${roomId}`);

  channel
    // -- Presence Handler --
    .on('presence', { event: 'sync' }, () => {
      const newState = channel.presenceState();
      const users: Set<string> = new Set();
      
      for (const id in newState) {
        const presences = newState[id] as any[];
        presences.forEach((p) => {
          if (p.user) users.add(p.user);
        });
      }
      callbacks.onPresenceUpdate(Array.from(users));
    })
    // -- New Message Handler --
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}` 
      },
      (payload) => {
        const newData = payload.new as any;
        if (newData) {
            callbacks.onNewSegment({
                id: newData.id.toString(),
                text: newData.text,
                author: newData.author,
                timestamp: new Date(newData.created_at).getTime(),
            });
        }
      }
    )
    // -- Deleted Message Handler --
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}`
      },
      () => fetchMessages() // Refresh list on delete
    )
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Track user presence once connected
        await channel.track({ 
          user: username,
          online_at: new Date().toISOString(),
        });
      }
    });

  return () => {
    supabase?.removeChannel(channel);
  };
};

export const sendMessageToRoom = async (roomId: string, text: string, author: string) => {
    if (!supabase) return null;
    
    // Return the inserted row so the UI can update immediately
    const { data, error } = await supabase.from('messages').insert({
        room_id: roomId,
        text: text,
        author: author
    }).select().single();

    if (error) {
      console.error("Error sending message:", error);
      throw error;
    }
    
    return data;
};

export const deleteMessageFromRoom = async (messageId: string) => {
    if (!supabase) return;
    await supabase.from('messages').delete().eq('id', messageId);
};

export const deleteAllMessagesInRoom = async (roomId: string) => {
    if (!supabase) return;
    
    console.log("Deleting all messages for room:", roomId);
    
    const { error, count } = await supabase
        .from('messages')
        .delete({ count: 'exact' })
        .eq('room_id', roomId);
        
    if (error) {
        console.error("Error clearing room:", error);
        throw error;
    }
    
    console.log(`Deleted ${count} messages.`);
};