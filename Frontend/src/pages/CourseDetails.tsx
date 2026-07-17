import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Info } from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { SkeletonBlock, SkeletonHero, SkeletonSurface } from '../components/PageSkeleton';

interface Exercise {
  id: string;
  name: string;
  body_part: string;
  target_muscle: string;
  video_url: string;
  instructions?: string[] | string;
}

type CourseDetailsCache = {
  exercises: Exercise[];
  courseTitle: string;
  courseDesc: string;
};

const courseDetailsCache = new Map<string, CourseDetailsCache>();

export function CourseDetailsSkeleton() {
  return (
    <div className="dashboard-page-shell flex flex-col gap-4 md:gap-5 animate-pulse pb-4 md:pb-6 lg:pb-7">
      <SkeletonHero titleWidth="w-[54%] max-w-[18rem]" chips={2} />

      <SkeletonSurface className="p-4 md:p-5">
        {SkeletonBlock('mb-4 h-5 w-48 rounded-lg')}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border-primary/50 bg-bg-tertiary/20 h-72 flex flex-col gap-3 p-4">
              <div className="h-44 w-full bg-bg-tertiary rounded-xl" />
              {SkeletonBlock('h-4 w-24 rounded-lg')}
              {SkeletonBlock('h-3 w-40 rounded-lg')}
            </div>
          ))}
        </div>
      </SkeletonSurface>
    </div>
  );
}

export default function CourseDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cacheKey = String(id || 'default');
  const initialCache = courseDetailsCache.get(cacheKey) || null;
  const [exercises, setExercises] = useState<Exercise[]>(() => initialCache?.exercises || []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [, setIsRefreshing] = useState(false);
  const [courseTitle, setCourseTitle] = useState(() => initialCache?.courseTitle || '');
  const [courseDesc, setCourseDesc] = useState(() => initialCache?.courseDesc || '');

  useEffect(() => {
    async function fetchCourse() {
      const cached = courseDetailsCache.get(cacheKey) || null;
      if (cached) {
        setExercises(cached.exercises);
        setCourseTitle(cached.courseTitle);
        setCourseDesc(cached.courseDesc);
      }
      setLoading(!cached);
      setIsRefreshing(!!cached);
      let queryBodyPart = '';
      let title = '';
      let desc = '';

      // Determine query based on course ID
      if (id === 'nang-ta') {
        title = 'Nâng tạ (Nâng cao)';
        desc = 'Các bài tập sử dụng tạ nặng để tăng cường sức mạnh và cơ bắp toàn diện.';
        queryBodyPart = 'upper arms'; // Just an example mapping
      } else if (id === 'phat-trien-co-bap') {
        title = 'Phát triển cơ bắp (Trung cấp)';
        desc = 'Tập trung vào sự phì đại cơ bắp với số rep vừa phải.';
        queryBodyPart = 'chest';
      } else if (id === 'crossfit') {
        title = 'CrossFit (Mọi cấp độ)';
        desc = 'Kết hợp các bài tập thể dục dụng cụ, nâng tạ và cardio cường độ cao.';
        queryBodyPart = 'cardio';
      } else if (id === 'cardio-dot-mo') {
        title = 'Cardio Đốt Mỡ (Dễ)';
        desc = 'Các bài tập nhịp tim cao giúp đốt mỡ hiệu quả mà không cần tạ.';
        queryBodyPart = 'cardio';
      } else {
        title = 'Khóa học';
        desc = 'Chi tiết khóa học.';
      }

      setCourseTitle(title);
      setCourseDesc(desc);

      // Fetch exercises from DB
      try {
        let q = supabase.from('exercises').select('*').limit(30);
        if (queryBodyPart) {
          q = q.eq('body_part', queryBodyPart);
        }
        
        const { data, error } = await q;
        if (!error && data) {
          // Normalize direct video URLs.
          const normalized = data.map((ex: any) => {
            let url = ex.video_url || '';
            if (url.startsWith('//')) url = `https:${url}`;
            else if (url.startsWith('http://')) url = `https://${url.slice(7)}`;
            return { ...ex, video_url: url };
          });
          setExercises(normalized);
          courseDetailsCache.set(cacheKey, {
            exercises: normalized,
            courseTitle: title,
            courseDesc: desc
          });
        } else if (error) {
          console.error(error);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    }

    fetchCourse();
  }, [id, cacheKey]);

  if (loading) return <CourseDetailsSkeleton />;

  return (
    <div className="dashboard-page-shell flex flex-col h-full gap-4 md:gap-6 px-0 overflow-hidden animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 bg-bg-secondary p-4 md:p-6 rounded-xl border border-border-primary shrink-0">
        <button 
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-bg-tertiary flex items-center justify-center text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-accent uppercase tracking-tight">{courseTitle}</h1>
          <p className="text-sm text-text-tertiary mt-1 md:mt-2 font-medium">{courseDesc}</p>
        </div>
      </div>

      {/* Exercise List */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-10">
        <h2 className="text-lg md:text-xl font-bold text-text-primary mb-4 flex items-center gap-2">
          <Play className="w-5 h-5 text-accent" />
          Danh sách bài tập ({exercises.length})
        </h2>
        
        {exercises.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
            {exercises.map((ex) => (
              <div key={ex.id} className="bg-bg-secondary border border-border-primary rounded-xl overflow-hidden hover:border-accent transition-all group flex flex-col cursor-pointer">
                <div className="themed-image-surface h-40 sm:h-48 w-full relative overflow-hidden shrink-0">
                  {ex.video_url ? (
                    <video src={ex.video_url} aria-label={ex.name} className="w-full h-full object-contain transition-transform duration-700 group-hover:scale-110" muted playsInline preload="metadata" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-bg-tertiary text-text-tertiary">
                      No Image
                    </div>
                  )}
                  <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider border border-white/10">
                    {ex.target_muscle || ex.body_part}
                  </div>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-sm md:text-base font-bold text-text-primary uppercase mb-2 line-clamp-1 group-hover:text-accent transition-colors">{ex.name}</h3>
                  <p className="text-xs text-text-tertiary line-clamp-2 md:line-clamp-3 flex-1 leading-relaxed">
                    {ex.instructions ? (Array.isArray(ex.instructions) ? ex.instructions.join(' ') : ex.instructions) : 'Không có hướng dẫn chi tiết cho bài tập này.'}
                  </p>
                  <button className="mt-4 w-full py-2.5 bg-bg-tertiary border border-border-primary text-text-primary text-xs font-bold rounded-xl flex items-center justify-center gap-2 group-hover:bg-accent group-hover:text-text-inverse group-hover:border-accent transition-all">
                    <Play className="w-3.5 h-3.5" /> Cách tập
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-bg-secondary rounded-xl border border-border-primary flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-bg-tertiary rounded-full flex items-center justify-center mb-4">
              <Info className="w-8 h-8 text-text-tertiary" />
            </div>
            <p className="text-text-secondary font-medium text-sm md:text-base max-w-sm">Không tìm thấy bài tập nào cho khóa học này trong cơ sở dữ liệu.</p>
          </div>
        )}
      </div>
    </div>
  );
}
