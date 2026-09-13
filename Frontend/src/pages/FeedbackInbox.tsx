import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '../lib/Api';

type Feedback = { id: string; category: string; message: string; context: string | null; status: 'new' | 'reviewing' | 'resolved'; created_at: string; target_type: 'challenge' | 'user' | null; target_id: string | null };
export default function FeedbackInbox() {
  const [items, setItems] = useState<Feedback[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError('');
      const response = await fetchWithAuth('/api/admin/feedback');
      if (!response.ok) throw new Error('Không tải được phản hồi hoặc tài khoản chưa có quyền quản trị.');
      setItems((await response.json()).data);
    } catch (error) { setError(error instanceof Error ? error.message : 'Không thể tải.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const update = async (item: Feedback, status: Feedback['status']) => {
    setPending(item.id);
    try {
      const response = await fetchWithAuth(`/api/admin/feedback/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!response.ok) throw new Error('Không cập nhật được phản hồi.');
      setItems((items) => items.map((row) => row.id === item.id ? { ...row, status } : row));
    } catch (error) { setError(error instanceof Error ? error.message : 'Không thể cập nhật.'); }
    finally { setPending(null); }
  };
  const removeContent = async (item: Feedback) => {
    if (!window.confirm(item.target_type === 'challenge' ? 'Gỡ tên, mô tả và hủy thử thách này?' : 'Gỡ tên và ảnh đại diện của tài khoản được báo cáo?')) return;
    setPending(item.id);
    try {
      const response = await fetchWithAuth(`/api/admin/feedback/${item.id}/remove-content`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Chưa gỡ được nội dung.');
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : 'Chưa gỡ được nội dung.'); }
    finally { setPending(null); }
  };
  return <main className="space-y-5 p-6 text-text-primary"><h1 className="text-2xl font-black">Phản hồi và báo cáo người dùng</h1><p role="alert">{error}</p><button onClick={() => void load()} className="text-accent">Làm mới</button>
    {items.map((item) => <article key={item.id} className="space-y-3 rounded-xl border border-border-primary bg-bg-secondary p-5"><p className="text-sm text-text-secondary">{item.category} · {new Date(item.created_at).toLocaleString('vi-VN')} · {item.status}</p><p className="whitespace-pre-wrap">{item.message}</p>{item.context && <blockquote className="whitespace-pre-wrap border-l-2 border-accent pl-4 text-text-secondary">{item.context}</blockquote>}<div className="flex flex-wrap gap-4">{item.target_id && item.status !== 'resolved' && <button disabled={Boolean(pending)} onClick={() => void removeContent(item)} className="text-red-400">Gỡ nội dung vi phạm</button>}<button disabled={Boolean(pending)} onClick={() => void update(item, 'reviewing')}>Đang xử lý</button><button disabled={Boolean(pending)} onClick={() => void update(item, 'resolved')} className="text-accent">Đã xử lý</button></div></article>)}
    {!items.length && !error && <p>Chưa có phản hồi.</p>}
  </main>;
}
