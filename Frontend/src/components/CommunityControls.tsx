import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';

export default function CommunityControls({ challengeId, title, participants }: {
  challengeId: string; title: string; participants: { user_id: string; display_name: string }[];
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState<{ user_id: string; display_name: string }[] | null>(null);
  const loadBlocked = async () => {
    const result = await supabase.rpc('get_blocked_users');
    if (result.error) setNotice('Chưa tải được danh sách chặn.'); else setBlocked(result.data || []);
  };
  const block = async (id: string) => {
    if (!user || busy || !window.confirm('Chặn sẽ đưa thành viên này khỏi nhóm do bạn tạo và khiến bạn rời các nhóm chung khác. Điểm danh trong nhóm đã rời cũng bị xóa. Tiếp tục?')) return;
    setBusy(true);
    try {
      const result = await supabase.from('user_blocks').upsert({ blocker_id: user.id, blocked_id: id }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
      if (result.error) throw result.error;
      window.location.assign('/challenges');
    } catch { setNotice('Chưa chặn được thành viên. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  const unblock = async (id: string) => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const result = await supabase.from('user_blocks').delete().eq('blocker_id', user.id).eq('blocked_id', id);
      if (result.error) throw result.error;
      await loadBlocked();
    } catch { setNotice('Chưa bỏ chặn được thành viên.'); }
    finally { setBusy(false); }
  };
  const reportUrl = (target_type: string, target_id: string, context: string) => `/support?${new URLSearchParams({ target_type, target_id, context, category: 'challenge_report' })}`;
  return <details className="rounded-xl border border-border-primary bg-bg-secondary p-5 text-text-primary">
    <summary className="cursor-pointer font-bold">An toàn trong nhóm</summary>
    <Link to={reportUrl('challenge', challengeId, title)} className="my-3 inline-block text-accent">Báo cáo nội dung thử thách</Link>
    {participants.filter((person) => person.user_id !== user?.id).map((person) => <div key={person.user_id} className="flex flex-wrap items-center gap-4 py-3"><span>{person.display_name}</span><button disabled={busy} onClick={() => void block(person.user_id)} className="text-red-400">Chặn</button><Link to={reportUrl('user', person.user_id, person.display_name)} className="text-accent">Báo cáo</Link></div>)}
    <button onClick={() => void loadBlocked()} className="py-3 text-accent">Thành viên đã chặn</button>
    {blocked?.map((person) => <div key={person.user_id} className="flex gap-4 py-2"><span>{person.display_name}</span><button disabled={busy} onClick={() => void unblock(person.user_id)} className="text-accent">Bỏ chặn</button></div>)}
    {blocked?.length === 0 && <p>Chưa có thành viên bị chặn.</p>}
    <p role="status">{notice}</p>
  </details>;
}
