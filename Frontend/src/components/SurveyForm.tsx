import React, { useState } from 'react';
import {
  User,
  Dumbbell,
  Home,
  Stethoscope,
  Loader2,
  Zap,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from './LoadingScreen';
import {
  DEFAULT_WORKOUT_FREQUENCY,
  WORKOUT_FREQUENCY_OPTIONS,
  normalizeWorkoutFrequency,
  weeklyWorkoutsToFrequency,
  workoutFrequencyToWeeklyWorkouts,
} from '../lib/WorkoutFrequency';
import {
  DEFAULT_MOTIVATION,
  normalizeMotivation,
} from '../lib/MotivationOptions';
import {
  DEFAULT_WORKOUT_DURATION,
  WORKOUT_DURATION_TAGS,
  normalizeWorkoutDurationTag,
} from '../lib/WorkoutDuration';

export type SurveyPlanSummary = {
  goal: string;
  experience: string;
  frequency: string;
  duration: string;
  targetCalories: number;
  location: string;
  todayWorkout: string;
  todayDuration: string;
  meals: string;
};

interface SurveyFormProps {
  onComplete: (summary?: SurveyPlanSummary) => void | Promise<void>;
  isOpen?: boolean;
  onClose?: () => void;
}

const TOTAL_STEPS = 3;
/** Nhãn ngắn trên thanh bước (theo mockup) */
const STEP_NAV_LABELS = [
  'Mục tiêu & cơ thể',
  'Tập luyện',
  'An toàn & ăn uống'
];

type StepIcon = React.ComponentType<{ className?: string }>;

type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  icon?: StepIcon;
};

const GOAL_OPTIONS: ChoiceOption[] = [
  { value: 'Giảm cân', label: 'Giảm cân', description: 'Ưu tiên giảm mỡ và kiểm soát calories' },
  { value: 'Tăng cơ', label: 'Tăng cơ', description: 'Tập kháng lực và tăng protein' },
  { value: 'Giữ dáng', label: 'Giữ dáng', description: 'Duy trì vóc dáng, sức khỏe và năng lượng' }
];

const GENDER_OPTIONS: ChoiceOption[] = [
  { value: 'Nam', label: 'Nam' },
  { value: 'Nữ', label: 'Nữ' },
  { value: 'Khác', label: 'Khác' }
];

const EXPERIENCE_OPTIONS: ChoiceOption[] = [
  { value: 'Người mới', label: 'Người mới', description: 'Cần bài dễ bám và ít rủi ro' },
  { value: 'Đã tập dưới 6 tháng', label: 'Dưới 6 tháng', description: 'Đã quen động tác cơ bản' },
  { value: 'Trung cấp', label: 'Trung cấp', description: 'Tập đều và muốn tăng hiệu quả' },
  { value: 'Nâng cao', label: 'Nâng cao', description: 'Cần lịch có tải và cấu trúc rõ' }
];

const LOCATION_OPTIONS: ChoiceOption[] = [
  { value: 'Phòng Gym', label: 'Phòng gym', description: 'Có máy và tạ đầy đủ', icon: Dumbbell },
  { value: 'Tập tại nhà (Home Workout)', label: 'Tập ở nhà', description: 'Ưu tiên bài ít hoặc không dụng cụ', icon: Home }
];

const DIET_OPTIONS: ChoiceOption[] = [
  { value: 'Bình thường', label: 'Bình thường' },
  { value: 'Ăn chay', label: 'Ăn chay' },
  { value: 'Ăn nhiều đạm (High Protein)', label: 'Nhiều đạm' },
  { value: 'Keto / Low Carb', label: 'Low Carb' },
  { value: 'Eat Clean', label: 'Eat Clean' }
];

const MEAL_OPTIONS: ChoiceOption[] = [
  { value: '2', label: '2 bữa' },
  { value: '3', label: '3 bữa' },
  { value: '4', label: '4 bữa', description: 'Có 1 bữa phụ' },
  { value: '5', label: '5 bữa nhỏ' }
];

interface StepSurveyCardProps {
  icon: StepIcon;
  iconWrapClass: string;
  iconClass: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

function StepSurveyCard({ icon: Icon, iconWrapClass, iconClass, title, subtitle, children }: StepSurveyCardProps) {
  return (
    <section className="rounded-[24px] border border-border-primary bg-bg-secondary/80 p-4 shadow-[0_20px_48px_rgba(0,0,0,0.12)] md:p-7">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconWrapClass}`}>
            <Icon className={iconClass} aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-lg font-black tracking-tight text-text-primary sm:text-xl md:text-2xl">{title}</h3>
            <p className="max-w-2xl text-sm font-semibold leading-6 text-text-secondary">{subtitle}</p>
          </div>
        </div>
        <div className="mt-6 space-y-5 md:mt-7 md:space-y-6">
          {children}
        </div>
      </div>
    </section>
  );
}

function ChoiceGrid({
  name,
  value,
  options,
  onChange,
  columns = 'md:grid-cols-3'
}: {
  name: string;
  value: string;
  options: ChoiceOption[];
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  columns?: string;
}) {
  return (
    <div className={`grid grid-cols-1 gap-2.5 ${columns}`}>
      {options.map((option) => {
        const active = value === option.value;
        const Icon = option.icon;
        return (
          <label
            key={option.value}
            className={`group flex min-h-[72px] cursor-pointer flex-col justify-between rounded-2xl border px-3.5 py-3 transition-colors sm:px-4 ${
              active
                ? 'border-accent/50 bg-accent/10 text-text-primary'
                : 'border-border-primary bg-bg-primary/55 text-text-secondary hover:border-accent/30 hover:bg-bg-primary'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={onChange}
              className="sr-only"
            />
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-black text-text-primary">{option.label}</span>
                {option.description ? (
                  <span className="mt-1 block text-xs font-semibold leading-5 text-text-tertiary">{option.description}</span>
                ) : null}
              </span>
              {Icon ? (
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-accent/15 text-accent' : 'bg-bg-secondary text-text-tertiary'}`}>
                  <Icon className="h-4 w-4" />
                </span>
              ) : (
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${active ? 'bg-accent' : 'border border-border-primary'}`} />
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

const birthdayToAge = (birthday: string | null | undefined) => {
  if (!birthday) return '';
  const date = new Date(birthday);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age -= 1;
  return age > 0 ? String(age) : '';
};

const ageToBirthday = (age: string) => {
  const parsedAge = Number(age);
  if (!Number.isFinite(parsedAge) || parsedAge <= 0) return null;
  return `${new Date().getFullYear() - Math.round(parsedAge)}-01-01`;
};

const hasPositiveNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const estimateTargetCalories = ({
  gender,
  age,
  height,
  weight,
  goal,
  frequency
}: {
  gender: string;
  age: string;
  height: string;
  weight: string;
  goal: string;
  frequency: string;
}) => {
  const parsedAge = Number(age) || 28;
  const parsedHeight = Number(height) || 170;
  const parsedWeight = Number(weight) || 70;
  const genderOffset = gender === 'Nam' ? 5 : gender === 'Nữ' ? -161 : -78;
  const bmr = 10 * parsedWeight + 6.25 * parsedHeight - 5 * parsedAge + genderOffset;
  const weeklyWorkouts = workoutFrequencyToWeeklyWorkouts(frequency);
  const activityMultiplier = 1.2 + Math.min(Math.max(weeklyWorkouts, 0), 6) * 0.05;
  const goalAdjustment = goal === 'Giảm cân' ? -350 : goal === 'Tăng cơ' ? 250 : 0;
  return Math.max(1200, Math.round((bmr * activityMultiplier + goalAdjustment) / 50) * 50);
};

export default function SurveyForm({ onComplete, isOpen, onClose }: SurveyFormProps) {
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [submitError, setSubmitError] = useState('');
  // Các giá trị tầng 2 dùng mặc định để tạo kế hoạch đầu tiên nhanh hơn.
  const [formData, setFormData] = useState({
    // Tầng 1: thông tin tối thiểu cho kế hoạch đầu tiên
    full_name: user?.user_metadata?.full_name || '',
    email: user?.email || '',
    phone: '',
    gender: 'Nam',
    birthday: '',
    age: '',
    job: '',

    // Giá trị nâng cao vẫn giữ mặc định để không làm thiếu payload backend
    height: '',
    weight: '',
    target_weight: '',
    body_fat: '',
    neck: '',
    chest: '',
    waist: '',
    hips: '',
    // BMI sẽ được tính tự động, không cần trong state input
    activity_level: DEFAULT_WORKOUT_FREQUENCY,
    fitness_goal: 'Giảm cân',
    workout_time: 'Sáng sớm',
    workout_duration: DEFAULT_WORKOUT_DURATION,
    experience_level: 'Người mới',
    work_nature: 'Ngồi văn phòng nhiều',
    workout_location: 'Phòng Gym',
    equipment_available: 'Đầy đủ tạ & máy móc',

    // Tầng 2: có thể bổ sung sau trong hồ sơ
    diet_preference: 'Bình thường',
    daily_water_goal: '2',
    meals_per_day: '3',
    cooking_ability: 'Tự nấu 100%',
    budget_level: 'Trung bình',
    current_diet: '',
    allergies: '',
    health_condition: '',
    injuries: 'Không',
    medications: 'Không sử dụng thuốc',
    medications_extra: '',
    smoke_drink: 'Không',

    // Tầng 2: có thể hỏi sau
    sleep_hours: '7',
    sleep_quality: 'Tốt',
    mood: 'Bình thường',
    stress_level: 'Thấp - Cuộc sống thoải mái',
    expectations: '',
    motivation: DEFAULT_MOTIVATION
  });

  React.useEffect(() => {
    async function loadCurrentData() {
      if (!user || !isOpen) return;
      setIsPreloading(true);
      try {
        const [p, b, l, h] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).single(),
          supabase.from('body_metrics').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('lifestyle_settings').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('health_conditions').select('*').eq('user_id', user.id).maybeSingle()
        ]);
        // ... (data update logic remains same)
        if (p.data) {
            const rawMeds = h.data?.medications || '';
            const standardMedOptions = [
              'Không sử dụng thuốc', 'Thuốc huyết áp', 'Thuốc tiểu đường / kiểm soát đường huyết',
              'Thuốc tim mạch', 'Thuốc hen suyễn / hô hấp', 'Thuốc giảm đau / kháng viêm',
              'Thuốc xương khớp', 'Thuốc dạ dày', 'Thuốc dị ứng', 'Thuốc nội tiết / hormone',
              'Thuốc an thần / hỗ trợ giấc ngủ', 'Vitamin / thực phẩm bổ sung', 'Khác'
            ];
            
            let medType = 'Không sử dụng thuốc';
            let medExtra = '';
            
            if (rawMeds && rawMeds !== 'Không sử dụng thuốc') {
              const matchedOpt = standardMedOptions.find(opt => rawMeds.startsWith(opt) && opt !== 'Không sử dụng thuốc');
              if (matchedOpt) {
                medType = matchedOpt;
                medExtra = rawMeds.substring(matchedOpt.length).replace(/^ - /, '').trim();
              } else {
                medType = 'Khác';
                medExtra = rawMeds;
              }
            }

          setFormData(prev => ({
            ...prev,
            full_name: p.data.full_name || prev.full_name,
            phone: p.data.phone || '',
            gender: p.data.gender || 'Nam',
            birthday: p.data.birthday || '',
            age: birthdayToAge(p.data.birthday) || prev.age,
            job: p.data.job || '',
            height: b.data?.height?.toString() || prev.height,
            weight: b.data?.weight?.toString() || prev.weight,
            target_weight: b.data?.target_weight?.toString() || prev.target_weight,
            body_fat: b.data?.body_fat?.toString() || prev.body_fat,
            neck: (b.data?.neck && b.data.neck !== 0) ? b.data.neck.toString() : '',
            chest: (b.data?.chest && b.data.chest !== 0) ? b.data.chest.toString() : '',
            waist: (b.data?.waist && b.data.waist !== 0) ? b.data.waist.toString() : '',
            hips: (b.data?.hips && b.data.hips !== 0) ? b.data.hips.toString() : '',
            activity_level: normalizeWorkoutFrequency(
              l.data?.activity_level || weeklyWorkoutsToFrequency(l.data?.weekly_workouts) || prev.activity_level
            ),
            fitness_goal: l.data?.fitness_goal || prev.fitness_goal,
            diet_preference: l.data?.diet_preference === 'Ăn chay (Có thể ăn chay)' ? 'Ăn chay' : (l.data?.diet_preference || prev.diet_preference),
            cooking_ability: l.data?.cooking_ability === 'Tự nấu tối, ăn ngoài trưa' ? 'Ăn trưa ở ngoài, tối tự nấu' : (l.data?.cooking_ability || prev.cooking_ability),
            budget_level: l.data?.budget_level === 'Sinh viên (Rẻ, Tiết kiệm)' ? 'Tiết kiệm' : (l.data?.budget_level === 'Trung bình (Cơ bản)' ? 'Trung bình' : (l.data?.budget_level === 'Cao cấp (Đủ loại thực phẩm)' ? 'Thoải mái' : (l.data?.budget_level || prev.budget_level))),
            current_diet: l.data?.current_diet || '',
            workout_location: l.data?.workout_location === 'Phòng Gym chuyên nghiệp'
              ? 'Phòng Gym'
              : (l.data?.workout_location || prev.workout_location),
            workout_time: l.data?.workout_time || prev.workout_time,
            workout_duration: normalizeWorkoutDurationTag(
              l.data?.workout_duration?.toString() || prev.workout_duration
            ),
            equipment_available: ({
              'Đầy đủ tạ & máy móc (Gym)': 'Đầy đủ tạ & máy móc',
              'Tạ đơn (Dumbbells) & Thảm': 'Tạ đơn & Thảm',
              'Dây kháng lực (Resistance Bands)': 'Dây kháng lực',
              'Không dụng cụ (Calisthenics)': 'Không dụng cụ',
            } as Record<string, string>)[l.data?.equipment_available || '']
              || l.data?.equipment_available
              || prev.equipment_available,
            experience_level: l.data?.experience_level || prev.experience_level,
            meals_per_day: l.data?.meals_per_day?.toString() || prev.meals_per_day,
            daily_water_goal: l.data?.daily_water_goal?.toString() || prev.daily_water_goal,
            health_condition: h.data?.health_condition || '',
            allergies: h.data?.medical_history || prev.allergies,
            injuries: h.data?.injuries || 'Không',
            medications: medType,
            medications_extra: medExtra,
            smoke_drink: h.data?.smoke_drink || 'Không',
            stress_level: h.data?.stress_level || 'Thấp - Cuộc sống thoải mái',
            sleep_hours: h.data?.sleep_hours?.toString() || prev.sleep_hours,
            expectations: l.data?.expectations || '',
            motivation: normalizeMotivation(l.data?.motivation),
          }));
        }
      } catch (e) {
        console.error('Error preload:', e);
      } finally {
        setIsPreloading(false);
      }
    }
    loadCurrentData();
  }, [user, isOpen]);

  React.useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setIsSubmitted(false);
    }
  }, [isOpen]);

  const modalMode = Boolean(isOpen);
  const progressPercent = (currentStep / TOTAL_STEPS) * 100;

  const getFirstInvalidStep = (): number | null => {
    if (
      !formData.fitness_goal ||
      !formData.gender ||
      !hasPositiveNumber(formData.age) ||
      !hasPositiveNumber(formData.height) ||
      !hasPositiveNumber(formData.weight)
    ) {
      return 1;
    }
    if (
      !formData.experience_level ||
      !formData.workout_location ||
      !formData.activity_level ||
      !formData.workout_duration
    ) {
      return 2;
    }
    return null;
  };

  const goNext = () => {
    setIsSubmitted(true);
    if (currentStep === 1) {
      if (
        !formData.fitness_goal ||
        !formData.gender ||
        !hasPositiveNumber(formData.age) ||
        !hasPositiveNumber(formData.height) ||
        !hasPositiveNumber(formData.weight)
      ) {
        return;
      }
    }
    if (currentStep === 2) {
      if (
        !formData.experience_level ||
        !formData.workout_location ||
        !formData.activity_level ||
        !formData.workout_duration
      ) {
        return;
      }
    }
    setIsSubmitted(false);
    if (currentStep < TOTAL_STEPS) setCurrentStep(s => s + 1);
  };

  const goPrev = () => {
    setIsSubmitted(false);
    setSubmitError('');
    setCurrentStep(s => Math.max(1, s - 1));
  };

  if (isPreloading) {
    return (
      <div className="fixed inset-0 z-[70]">
        <LoadingScreen />
      </div>
    );
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'workout_location') {
        next.equipment_available = value === 'Phòng Gym' ? 'Đầy đủ tạ & máy móc' : 'Không dụng cụ';
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (!user) {
      setSubmitError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      goNext();
      return;
    }

    setIsSubmitted(true);
    const invalidStep = getFirstInvalidStep();
    if (invalidStep !== null) {
      setCurrentStep(invalidStep);
      setSubmitError(`Vui lòng điền đầy đủ thông tin bắt buộc ở bước ${invalidStep}.`);
      return;
    }
    setLoading(true);

    try {
      const resolvedBirthday = formData.birthday || ageToBirthday(formData.age);
      const resolvedFullName = formData.full_name.trim() || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Thành viên';
      const resolvedTargetWeight = parseFloat(formData.target_weight) || parseFloat(formData.weight) || 0;
      const resolvedEquipment = formData.workout_location === 'Phòng Gym' ? 'Đầy đủ tạ & máy móc' : 'Không dụng cụ';

      // 1. Cập nhật hoặc Tạo mới Profile (Thông tin cơ bản)
      const profilePromise = supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: resolvedFullName,
          email: formData.email,
          phone: formData.phone,
          gender: formData.gender,
          birthday: resolvedBirthday,
          job: formData.job,
          updated_at: new Date().toISOString()
        });

      // 2. Lưu số đo cơ thể đầy đủ
      const bodyMetricsPromise = supabase
        .from('body_metrics')
        .insert({
          user_id: user.id,
          height: parseFloat(formData.height) || 0,
          weight: parseFloat(formData.weight) || 0,
          target_weight: resolvedTargetWeight,
          body_fat: formData.body_fat ? parseFloat(formData.body_fat) : null,
          neck: formData.neck ? parseFloat(formData.neck) : null,
          chest: formData.chest ? parseFloat(formData.chest) : null,
          waist: formData.waist ? parseFloat(formData.waist) : null,
          hips: formData.hips ? parseFloat(formData.hips) : null
        });

      // 3. Cập nhật Lối sống & Thói quen toàn diện
      const lifestylePromise = supabase
        .from('lifestyle_settings')
        .upsert({
          user_id: user.id,
          activity_level: normalizeWorkoutFrequency(formData.activity_level),
          weekly_workouts: workoutFrequencyToWeeklyWorkouts(formData.activity_level),
          fitness_goal: formData.fitness_goal,
          diet_preference: formData.diet_preference,
          cooking_ability: formData.cooking_ability,
          budget_level: formData.budget_level,
          current_diet: formData.current_diet,
          workout_location: formData.workout_location,
          workout_time: formData.workout_time,
          workout_duration: parseInt(normalizeWorkoutDurationTag(formData.workout_duration), 10),
          equipment_available: resolvedEquipment,
          experience_level: formData.experience_level,
          meals_per_day: parseInt(formData.meals_per_day, 10) || 3,
          daily_water_goal: parseFloat(formData.daily_water_goal) || 2.0,
          motivation: formData.motivation,
          expectations: formData.expectations,
          updated_at: new Date().toISOString()
        });

      const finalMedications = formData.medications === 'Không sử dụng thuốc'
        ? 'Không sử dụng thuốc'
        : formData.medications_extra.trim() 
          ? `${formData.medications} - ${formData.medications_extra.trim()}`
          : formData.medications;

      // 4. Cập nhật Tình trạng Y tế chi tiết
      const healthPromise = supabase
        .from('health_conditions')
        .upsert({
          user_id: user.id,
          health_condition: formData.health_condition,
          medical_history: formData.allergies,
          injuries: formData.injuries,
          medications: finalMedications,
          smoke_drink: formData.smoke_drink,
          stress_level: formData.stress_level,
          sleep_quality: formData.sleep_quality,
          sleep_hours: parseFloat(formData.sleep_hours) || 7,
          updated_at: new Date().toISOString()
        });


      // 1. ĐẢM BẢO Profile tồn tại trước (Sequential to avoid FK errors)
      const { error: pError } = await profilePromise;
      if (pError) throw pError;
      
      // 2. Chạy các lệnh còn lại (Concurrent ok now)
      const results = await Promise.all([
        bodyMetricsPromise,
        lifestylePromise,
        healthPromise
      ]);

      // In chi tiết lỗi (nếu có) ra console để debug
      results.forEach((res, index) => {
        if (res.error) {
          console.error(`Error in promise ${index}:`, res.error);
        }
      });

      // Kiểm tra lỗi từ bất kỳ bảng nào
      const firstError = results.find(res => res.error)?.error;
      if (firstError) {
        throw firstError;
      }

      const durationMinutes = Number(normalizeWorkoutDurationTag(formData.workout_duration)) || Number(DEFAULT_WORKOUT_DURATION) || 30;
      const selectedMeals = MEAL_OPTIONS.find(option => option.value === formData.meals_per_day);
      const selectedFrequency = WORKOUT_FREQUENCY_OPTIONS.find(
        option => option.value === normalizeWorkoutFrequency(formData.activity_level)
      );
      const summary: SurveyPlanSummary = {
        goal: formData.fitness_goal,
        experience: formData.experience_level,
        frequency: selectedFrequency?.label || `${workoutFrequencyToWeeklyWorkouts(formData.activity_level)} buổi / tuần`,
        duration: `${durationMinutes}-${durationMinutes + 10} phút / buổi`,
        targetCalories: estimateTargetCalories({
          gender: formData.gender,
          age: formData.age,
          height: formData.height,
          weight: formData.weight,
          goal: formData.fitness_goal,
          frequency: formData.activity_level
        }),
        location: formData.workout_location === 'Tập tại nhà (Home Workout)' ? 'Tại nhà' : 'Phòng gym',
        todayWorkout: formData.experience_level === 'Người mới' ? 'Full Body Beginner' : 'Full Body Strength',
        todayDuration: `${durationMinutes} phút`,
        meals: selectedMeals?.label || `${formData.meals_per_day} bữa/ngày`
      };

      await refreshProfile();
      await onComplete(summary);
    } catch (err: any) {
      console.error('Error saving multi-table profile:', err);
      const message = err?.message || err?.details || 'Thông tin không hợp lệ';
      setSubmitError(`Lỗi hệ thống: ${message}. Vui lòng thử lại hoặc mở Console (F12) để xem chi tiết.`);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className={modalMode ? 'fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-5' : 'min-h-screen w-full bg-bg-primary'}>
      {/* Backdrop */}
      {modalMode ? <div className="themed-modal-backdrop absolute inset-0 backdrop-blur-md" /> : null}

      {/* Modal Content */}
      <div className={`relative grid w-full grid-cols-1 overflow-hidden border border-border-primary bg-bg-secondary ${
        modalMode
          ? 'max-w-5xl rounded-none shadow-[0_30px_90px_rgba(0,0,0,0.34)] animate-in zoom-in duration-300 md:rounded-[28px] lg:grid-cols-[280px_minmax(0,1fr)]'
          : 'mx-auto min-h-screen max-w-6xl rounded-none shadow-none xl:grid-cols-[320px_minmax(0,1fr)]'
      }`}>

        {/* Close Button (Only for Profile Editing) */}
        {isOpen && onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-[70] rounded-xl border border-border-primary bg-bg-primary/80 p-2 text-text-tertiary transition-colors hover:text-text-primary"
          >
            <X className="w-6 h-6" />
          </button>
        )}

        <aside className={`border-b border-border-primary bg-bg-secondary p-4 sm:p-5 lg:p-6 ${modalMode ? 'lg:border-b-0 lg:border-r' : 'xl:border-b-0 xl:border-r'}`}>
          <div className="themed-subtle-panel rounded-[24px] border p-4 shadow-[0_18px_42px_rgba(0,0,0,0.18)] sm:p-5">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Trợ lý cá nhân" className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">Trợ lý cá nhân</p>
                <h2 className="mt-1 text-lg font-black leading-tight text-text-primary sm:text-xl">
                  {isOpen ? "Cập nhật hồ sơ" : "Tạo kế hoạch đầu tiên"}
                </h2>
              </div>
            </div>

            <p className="mt-4 text-sm font-semibold leading-6 text-text-secondary">
              {isOpen
                ? "Cập nhật dữ liệu cốt lõi để kế hoạch tập luyện và thực đơn sát hơn."
                : "Trả lời nhanh vài thông tin chính. Trợ lý cá nhân sẽ chuẩn bị khung bắt đầu phù hợp với bạn."}
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2 xl:hidden">
              {STEP_NAV_LABELS.map((_, idx) => {
                const n = idx + 1;
                const active = n === currentStep;
                const done = currentStep > n;
                return (
                  <button
                    key={`mobile-step-${n}`}
                    type="button"
                    onClick={() => setCurrentStep(n)}
                    className={`rounded-2xl border px-2 py-2 text-center transition-colors ${
                      active
                        ? 'border-accent/45 bg-accent/12 text-accent'
                        : done
                          ? 'border-border-primary bg-bg-primary/70 text-text-primary'
                          : 'border-border-primary/60 bg-bg-primary/35 text-text-tertiary'
                    }`}
                  >
                    <span className="block text-[10px] font-black uppercase tracking-[0.14em]">Bước {n}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Tiến độ</p>
                <p className="text-xs font-black text-accent">{Math.round(progressPercent)}%</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-primary/70">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 hidden space-y-2.5 xl:block">
            {STEP_NAV_LABELS.map((label, idx) => {
              const n = idx + 1;
              const active = n === currentStep;
              const done = currentStep > n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCurrentStep(n)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? 'border-accent/45 bg-accent/10 text-accent'
                      : done
                        ? 'border-border-primary bg-bg-primary/70 text-text-primary'
                        : 'border-transparent bg-transparent text-text-secondary hover:border-border-primary hover:bg-bg-primary/50'
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-sm font-black ${
                    active || done ? 'bg-accent text-text-inverse' : 'bg-bg-secondary text-text-tertiary'
                  }`}>
                    {n}
                  </span>
                  <span>
                    <span className="block text-sm font-black text-text-primary">{label}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-text-tertiary">
                      {active ? 'Đang nhập' : done ? 'Đã qua' : 'Sắp tới'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-border-primary bg-bg-primary/55 p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-accent">Nhanh hơn</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
              Những thông tin nâng cao như ngân sách, lịch sinh hoạt, động lực có thể bổ sung sau.
            </p>
          </div>
        </aside>

        <div className={`flex min-h-0 flex-col bg-bg-primary ${modalMode ? 'max-h-[100dvh] md:max-h-[92vh]' : 'xl:min-h-screen'}`}>
          <div className="border-b border-border-primary bg-bg-secondary px-4 py-4 sm:px-5 md:px-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-text-primary">
                  Bước {currentStep}/{TOTAL_STEPS}
                </p>
                <p className="mt-1 text-sm font-semibold text-text-secondary">{STEP_NAV_LABELS[currentStep - 1]}</p>
              </div>
              <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-black text-accent">
                {Math.round(progressPercent)}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

        {/* Form Body */}
        <form id="survey-form" onSubmit={handleSubmit} className="custom-scrollbar flex-1 overflow-y-auto space-y-6 px-4 py-4 sm:px-5 md:space-y-8 md:px-7 md:py-6">
          {currentStep === 1 && (
          <StepSurveyCard
            icon={User}
            iconWrapClass="bg-accent/15 ring-1 ring-accent/25"
            iconClass="h-5 w-5 text-accent"
            title={"1. Mục tiêu & cơ thể"}
            subtitle={"Chỉ nhập các thông tin cần thiết để Trợ lý cá nhân tạo kế hoạch đầu tiên nhanh nhất."}
          >
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Mục tiêu"} <span className="text-red-500">*</span></label>
              <ChoiceGrid name="fitness_goal" value={formData.fitness_goal} options={GOAL_OPTIONS} onChange={handleInputChange} />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Giới tính"} <span className="text-red-500">*</span></label>
              <ChoiceGrid name="gender" value={formData.gender} options={GENDER_OPTIONS} onChange={handleInputChange} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Tuổi"} <span className="text-red-500">*</span></label>
                <input required type="number" min="1" name="age" value={formData.age} onChange={handleInputChange} className={`h-11 w-full rounded-xl border bg-bg-primary/70 px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent ${isSubmitted && !hasPositiveNumber(formData.age) ? 'border-red-500 animate-pulse' : 'border-border-primary'}`} placeholder="28" />
                {isSubmitted && !hasPositiveNumber(formData.age) && <p className="text-red-500 text-[10px] mt-1 font-medium">Vui lòng nhập tuổi</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Chiều cao (cm)"} <span className="text-red-500">*</span></label>
                <input required type="number" min="1" name="height" value={formData.height} onChange={handleInputChange} className={`h-11 w-full rounded-xl border bg-bg-primary/70 px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent ${isSubmitted && !hasPositiveNumber(formData.height) ? 'border-red-500 animate-pulse' : 'border-border-primary'}`} placeholder="170" />
                {isSubmitted && !hasPositiveNumber(formData.height) && <p className="text-red-500 text-[10px] mt-1 font-medium">Vui lòng nhập chiều cao</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Cân nặng (kg)"} <span className="text-red-500">*</span></label>
                <input required type="number" min="1" name="weight" value={formData.weight} onChange={handleInputChange} className={`h-11 w-full rounded-xl border bg-bg-primary/70 px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent ${isSubmitted && !hasPositiveNumber(formData.weight) ? 'border-red-500 animate-pulse' : 'border-border-primary'}`} placeholder="68" />
                {isSubmitted && !hasPositiveNumber(formData.weight) && <p className="text-red-500 text-[10px] mt-1 font-medium">Vui lòng nhập cân nặng</p>}
              </div>
            </div>
          </StepSurveyCard>
          )}

          {currentStep === 2 && (
          <StepSurveyCard
            icon={Zap}
            iconWrapClass="bg-accent/15 ring-1 ring-accent/25"
            iconClass="h-5 w-5 text-accent"
            title={"2. Khả năng tập luyện"}
            subtitle={"Trợ lý cá nhân dùng các thông tin này để chọn bài tập, lịch tuần và cường độ phù hợp."}
          >
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Trình độ tập luyện"} <span className="text-red-500">*</span></label>
              <ChoiceGrid name="experience_level" value={formData.experience_level} options={EXPERIENCE_OPTIONS} onChange={handleInputChange} columns="md:grid-cols-2" />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Bạn tập ở đâu?"} <span className="text-red-500">*</span></label>
              <ChoiceGrid name="workout_location" value={formData.workout_location} options={LOCATION_OPTIONS} onChange={handleInputChange} columns="md:grid-cols-2" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Số buổi có thể tập mỗi tuần"} <span className="text-red-500">*</span></label>
                <select name="activity_level" value={normalizeWorkoutFrequency(formData.activity_level)} onChange={handleInputChange} className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary/70 px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent">
                  {WORKOUT_FREQUENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Thời lượng mỗi buổi"} <span className="text-red-500">*</span></label>
                <select name="workout_duration" value={normalizeWorkoutDurationTag(formData.workout_duration)} onChange={handleInputChange} className="h-11 w-full rounded-xl border border-border-primary bg-bg-primary/70 px-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent">
                  {WORKOUT_DURATION_TAGS.map((minutes) => (
                    <option key={minutes} value={String(minutes)}>{`${minutes} phút`}</option>
                  ))}
                </select>
              </div>
            </div>
          </StepSurveyCard>
          )}

          {currentStep === 3 && (
          <StepSurveyCard
            icon={Stethoscope}
            iconWrapClass="bg-accent/15 ring-1 ring-accent/25"
            iconClass="h-5 w-5 text-accent"
            title={"3. An toàn & ăn uống"}
            subtitle={"Thông tin này giúp Trợ lý cá nhân tránh bài tập, món ăn không phù hợp và chia thực đơn đúng nhịp sinh hoạt."}
          >
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Chế độ ăn ưu tiên"} <span className="text-red-500">*</span></label>
              <ChoiceGrid name="diet_preference" value={formData.diet_preference} options={DIET_OPTIONS} onChange={handleInputChange} columns="sm:grid-cols-2 lg:grid-cols-5" />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Số bữa/ngày"} <span className="text-red-500">*</span></label>
              <ChoiceGrid name="meals_per_day" value={formData.meals_per_day} options={MEAL_OPTIONS} onChange={handleInputChange} columns="sm:grid-cols-2 lg:grid-cols-4" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Có chấn thương không?"}</label>
                <textarea name="injuries" value={formData.injuries} onChange={handleInputChange} className="h-28 w-full resize-none rounded-2xl border border-border-primary bg-bg-primary/70 px-4 py-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent" placeholder={"Không, hoặc ghi: đau gối, đau lưng, cổ tay yếu..."} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{"Có dị ứng hoặc món không ăn được không?"}</label>
                <textarea name="allergies" value={formData.allergies} onChange={handleInputChange} className="h-28 w-full resize-none rounded-2xl border border-border-primary bg-bg-primary/70 px-4 py-3 text-sm font-semibold text-text-primary outline-none transition-colors focus:border-accent" placeholder={"Không, hoặc ghi: hải sản, sữa, đậu phộng, thịt bò..."} />
              </div>
            </div>
          </StepSurveyCard>
          )}

        </form>

        {/* Footer */}
        <div className="flex flex-col gap-4 border-t border-border-primary bg-bg-secondary/96 px-4 py-4 backdrop-blur-xl sm:px-5 md:px-7">
          {submitError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {submitError}
            </div>
          )}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="order-2 flex min-w-0 flex-1 items-center sm:order-1 sm:pr-4">
            <p className="text-sm font-black tracking-tight leading-snug">
              <span className="text-text-secondary font-bold">
                {"Bạn có thể bổ sung thông tin nâng cao sau khi xem kế hoạch đầu tiên. "}
              </span>
              <span className="text-text-secondary font-bold">{"Bước này chỉ hỏi dữ liệu cần thiết."}</span>
            </p>
          </div>
          <div className="order-1 flex w-full shrink-0 flex-col-reverse gap-2 sm:order-2 sm:ml-auto sm:w-auto sm:flex-row sm:gap-3">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={goPrev}
                disabled={loading}
                className="w-full sm:w-auto py-2.5 px-5 rounded-xl border border-border-primary text-text-primary font-bold text-sm hover:bg-bg-tertiary/70 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
                Quay lại
              </button>
            )}
            {currentStep < TOTAL_STEPS ? (
              <button
                key="survey-next-step"
                type="button"
                onClick={goNext}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
              >
                Tiếp theo
                <ChevronRight className="w-4 h-4 text-text-inverse" />
              </button>
            ) : (
              <button
                key="survey-submit"
                type="submit"
                form="survey-form"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-8 py-2.5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang tạo kế hoạch...
                  </>
                ) : (
                  <>
                    {isOpen ? "CẬP NHẬT HỒ SƠ" : "TẠO KẾ HOẠCH ĐẦU TIÊN"}
                    <Zap className="w-4 h-4 text-text-inverse" />
                  </>
                )}
              </button>
            )}
          </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
