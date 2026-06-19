import { askFitlyCoach } from './coachConversationService';
import { getResponseModeForIntent, normalizeVietnameseText } from './aiRouterService';
import { AIChatContext, AIChatMealSummary, AIChatResponse, AIIntent } from './types';

const getMealTypeLabel = (mealType?: string | null): string => {
  const key = String(mealType || '').toLowerCase();
  if (key === 'breakfast') return 'Bua sang';
  if (key === 'lunch') return 'Bua trua';
  if (key === 'dinner') return 'Bua toi';
  if (key === 'snack') return 'Bua phu';
  return 'Bua an';
};

const formatMealCalories = (meal: AIChatMealSummary): number => {
  const quantity = Number(meal.quantity || 1);
  return Math.round(Number(meal.calories || 0) * quantity);
};

const hasAny = (value: string, terms: string[]) => terms.some((term) => value.includes(term));

const isGreetingMessage = (message: string): boolean => {
  const normalized = normalizeVietnameseText(message);
  if (!normalized) return false;
  const wordCount = normalized.split(' ').filter(Boolean).length;
  return wordCount <= 4 && /^(hi|hello|hey|alo|chao|xin chao|chao coach|hi coach)(\b|$)/.test(normalized);
};

const isShortFollowUpMessage = (message: string): boolean => {
  const normalized = normalizeVietnameseText(message);
  return [
    'con gi nua',
    'con nua khong',
    'co gi nua',
    'gom nhung gi',
    'bai nao',
    'bai nao nua',
    'mon nao',
    'mon nao nua',
    'ke tiep di',
    'noi tiep di',
    'chi tiet hon',
    'cu the hon',
  ].includes(normalized);
};

const getPreviousTopic = (history?: AIChatContext['chatHistory']): 'workout' | 'meal' | null => {
  const rows = Array.isArray(history) ? history : [];
  for (const item of [...rows].reverse()) {
    const normalized = normalizeVietnameseText(item.content);
    if (!normalized) continue;
    if (hasAny(normalized, ['bai tap', 'workout', 'lich tap', 'buoi tap', 'tap gi', 'set x'])) {
      return 'workout';
    }
    if (hasAny(normalized, ['thuc don', 'mon an', 'bua', 'an gi', 'protein', 'meal'])) {
      return 'meal';
    }
  }
  return null;
};

const buildGreetingReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hôm nay';
  const workoutCount = Number(context?.todayWorkoutCount || 0);
  const mealCount = Number(context?.todayMealCount || 0);
  const workoutText = workoutCount > 0 ? `${workoutCount} bài tập` : 'chưa có bài tập';
  const mealText = mealCount > 0 ? `${mealCount} món ăn` : 'chưa có thực đơn';
  return `Chào bạn. Mình đang theo ${dayLabel}: ${workoutText} và ${mealText}. Bạn muốn xem danh sách bài tập, chỉnh buổi tập nhẹ hơn, hay hỏi về bữa ăn hôm nay?`;
};

const isDailyCalorieQuestion = (message: string): boolean => {
  const normalized = normalizeVietnameseText(message);
  const mentionsCalories = hasAny(normalized, ['kcal', 'calo', 'calories', 'calorie', 'cal']);
  const asksAmount = hasAny(normalized, ['bao nhieu', 'nen an', 'can an', 'mot ngay', 'hang ngay', 'moi ngay', 'target', 'muc']);
  return mentionsCalories && asksAmount;
};

const readNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
};

const getAgeYears = (profile?: Record<string, unknown> | null) => {
  const birthday = String(
    profile?.birthday ||
      profile?.birth_date ||
      profile?.date_of_birth ||
      '',
  );
  if (!birthday) return 30;
  const birthDate = new Date(birthday);
  if (Number.isNaN(birthDate.getTime())) return 30;
  const now = new Date();
  const age = now.getFullYear() - birthDate.getFullYear();
  return Math.max(15, Math.min(90, age));
};

const getActivityFactor = (lifestyle?: Record<string, unknown> | null) => {
  const weeklyWorkouts = Number(lifestyle?.weekly_workouts || 0);
  const activityText = normalizeVietnameseText(String(lifestyle?.activity_level || lifestyle?.weekly_workouts || ''));

  if (hasAny(activityText, ['it van dong', 'sedentary', 'khong tap'])) return 1.2;
  if (hasAny(activityText, ['nhe', 'light'])) return 1.35;
  if (hasAny(activityText, ['vua', 'moderate', '3 4', '3-4'])) return 1.45;
  if (hasAny(activityText, ['nang', 'active', '5 6', '5-6'])) return 1.6;
  if (hasAny(activityText, ['rat nang', 'very active', 'hang ngay'])) return 1.75;

  if (weeklyWorkouts >= 6) return 1.65;
  if (weeklyWorkouts >= 5) return 1.55;
  if (weeklyWorkouts >= 3) return 1.45;
  if (weeklyWorkouts >= 1) return 1.3;
  return 1.25;
};

const roundToNearest50 = (value: number) => Math.round(value / 50) * 50;

const buildDailyCalorieTargetReply = (context?: AIChatContext): string => {
  const body = context?.bodyMetrics || {};
  const profile = context?.profile || {};
  const lifestyle = context?.lifestyle || {};
  const weight = readNumber((body as any).weight, (profile as any).weight);
  const height = readNumber((body as any).height, (profile as any).height);

  if (!weight || !height) {
    return [
      'Để tính kcal sát hơn, mình cần tối thiểu cân nặng, chiều cao và mức vận động.',
      'Cách tạm tính nhanh: lấy cân nặng x 28-32 kcal để ra mức duy trì, nếu muốn giảm cân thì trừ khoảng 300-500 kcal/ngày. Ví dụ 80kg thường bắt đầu quanh 1.900-2.300 kcal/ngày khi giảm cân.',
    ].join('\n\n');
  }

  const age = getAgeYears(profile);
  const genderText = normalizeVietnameseText(String((profile as any).gender || (body as any).gender || 'male'));
  const genderOffset = genderText.includes('nu') || genderText.includes('female') ? -161 : 5;
  const bmr = 10 * weight + 6.25 * height - 5 * age + genderOffset;
  const maintenance = roundToNearest50(bmr * getActivityFactor(lifestyle));
  const targetWeight = readNumber((body as any).target_weight, (profile as any).target_weight);
  const goalText = normalizeVietnameseText(String((lifestyle as any).fitness_goal || ''));
  const wantsLoss = goalText.includes('giam') || goalText.includes('loss') || (!!targetWeight && targetWeight < weight);
  const wantsGain = goalText.includes('tang co') || goalText.includes('muscle') || goalText.includes('bulk') || (!!targetWeight && targetWeight > weight);

  const minCalories = wantsGain
    ? maintenance + 150
    : wantsLoss
      ? Math.max(Math.round(bmr), maintenance - 500)
      : maintenance - 150;
  const maxCalories = wantsGain
    ? maintenance + 300
    : wantsLoss
      ? Math.max(Math.round(bmr + 150), maintenance - 300)
      : maintenance + 150;

  const proteinMin = Math.round(weight * 1.6);
  const proteinMax = Math.round(weight * 2);
  const fatMin = Math.round(weight * 0.6);
  const fatMax = Math.round(weight * 0.9);
  const goalLabel = wantsGain ? 'tăng cơ' : wantsLoss ? 'giảm cân' : 'giữ cân';

  return [
    `Với dữ liệu hiện tại của bạn (${Math.round(weight)}kg, ${Math.round(height)}cm), mức duy trì ước tính khoảng ${maintenance - 100}-${maintenance + 100} kcal/ngày.`,
    `Nếu mục tiêu là ${goalLabel}, mình sẽ bắt đầu ở khoảng ${roundToNearest50(minCalories)}-${roundToNearest50(maxCalories)} kcal/ngày, rồi theo dõi 10-14 ngày để chỉnh tiếp.`,
    `Macro dễ bám: protein ${proteinMin}-${proteinMax}g/ngày, fat ${fatMin}-${fatMax}g/ngày, phần kcal còn lại để cho carb. Nếu cân không đi đúng hướng sau 2 tuần, tăng/giảm 150-200 kcal là đủ.`,
  ].join('\n\n');
};

const buildNoMealPlanSuggestionReply = (message: string, context?: AIChatContext): string => {
  const normalized = normalizeVietnameseText(message);
  const mealLabel = normalized.includes('sang')
    ? 'bua sang'
    : normalized.includes('toi')
      ? 'bua toi'
      : normalized.includes('phu') || normalized.includes('snack')
        ? 'bua phu'
        : 'bua trua';
  const mealDisplayLabel =
    mealLabel === 'bua sang'
      ? 'bữa sáng'
      : mealLabel === 'bua toi'
        ? 'bữa tối'
        : mealLabel === 'bua phu'
          ? 'bữa phụ'
          : 'bữa trưa';
  const lifestyle = context?.lifestyle || {};
  const body = context?.bodyMetrics || {};
  const goalText = normalizeVietnameseText(String((lifestyle as any).fitness_goal || ''));
  const dietText = normalizeVietnameseText(String((lifestyle as any).diet_preference || (lifestyle as any).current_diet || ''));
  const isMuscleGain = goalText.includes('tang co') || goalText.includes('muscle');
  const isWeightLoss = goalText.includes('giam') || goalText.includes('loss');
  const isVegetarian = dietText.includes('chay') || dietText.includes('vegetarian') || dietText.includes('vegan');
  const targetCalories = readNumber((lifestyle as any).target_calories);
  const mealsPerDay = Math.max(2, Math.min(5, Math.round(Number((lifestyle as any).meals_per_day || 3))));
  const perMealCalories = targetCalories ? Math.round(targetCalories / mealsPerDay / 50) * 50 : 0;
  const weight = readNumber((body as any).weight, (context?.profile as any)?.weight);

  const options =
    isVegetarian
      ? mealLabel === 'bua sang'
        ? [
            'Yến mạch 50g + sữa đậu nành/Greek yogurt + 1 quả chuối.',
            'Bánh mì nguyên cám + trứng + đậu hũ áp chảo + rau.',
            'Sữa chua Hy Lạp + trái cây + hạt chia/hạnh nhân vừa phải.',
          ]
        : mealLabel === 'bua toi'
          ? [
              'Đậu hũ/tempeh 180g + rau xanh + 1/2-1 chén cơm.',
              'Trứng chiên ít dầu + salad lớn + khoai lang 150-200g.',
              'Đậu lăng/đậu gà hầm rau củ + cơm vừa phải.',
            ]
          : mealLabel === 'bua phu'
            ? [
                'Sữa chua Hy Lạp hoặc sữa đậu nành + trái cây.',
                'Đậu hũ non + cacao không đường.',
                '1 nắm hạt nhỏ + 1 quả chuối nếu cần năng lượng.',
              ]
            : [
                'Đậu hũ/tempeh 180g + 1 chén cơm + rau xanh.',
                'Đậu gà/đậu lăng + khoai lang 200g + salad.',
                'Trứng + đậu hũ sốt cà chua + cơm vừa phải.',
              ]
      : mealLabel === 'bua sang'
      ? [
          '2 trứng + 1 hũ sữa chua Hy Lạp không đường + 1 quả chuối.',
          'Yến mạch 50g + sữa ít béo + 1 muỗng whey hoặc 150g sữa chua.',
          'Bánh mì nguyên cám + ức gà hoặc cá ngừ + rau xà lách.',
        ]
      : mealLabel === 'bua toi'
        ? [
            'Cá hồi hoặc cá thu 150g + rau luộc/xào ít dầu + 1/2 chén cơm.',
            'Ức gà áp chảo 160g + salad lớn + khoai lang 150g.',
            'Đậu phụ sốt cà chua + trứng luộc + rau xanh, tinh bột vừa phải.',
          ]
        : mealLabel === 'bua phu'
          ? [
              'Sữa chua Hy Lạp + chuối hoặc dâu.',
              '1 ly sữa ít béo + 1 nắm hạt nhỏ.',
              '2 trứng luộc hoặc 1 hộp cá ngừ nhỏ nếu cần thêm protein.',
            ]
          : [
              'Ức gà áp chảo 160-180g + 1 chén cơm + rau xanh.',
              'Cá ngừ/cá hồi 150g + khoai lang 200g + salad.',
              'Bò nạc 120-150g hoặc đậu phụ + cơm vừa phải + rau luộc.',
            ];

  const goalNote = isMuscleGain
    ? 'Nếu đang tăng cơ, tăng thêm 1 phần tinh bột hoặc sữa sau bữa.'
    : isWeightLoss
      ? 'Nếu đang giảm cân, giữ rau nhiều và giảm bớt dầu/nước sốt.'
      : 'Nếu chưa rõ mục tiêu, giữ khẩu phần vừa phải và ưu tiên protein.';
  const calorieNote = perMealCalories
    ? `Với mức ${targetCalories} kcal/ngày và ${mealsPerDay} bữa/ngày, bữa này nên xoay quanh ${perMealCalories - 100}-${perMealCalories + 100} kcal.`
    : 'Mình chưa thấy mức kcal mục tiêu nên tạm giữ khẩu phần vừa phải.';
  const proteinNote = weight
    ? `Protein ngày nên nằm khoảng ${Math.round(weight * 1.6)}-${Math.round(weight * 2)}g, nên chia đều vào các bữa.`
    : 'Nếu cập nhật cân nặng, mình sẽ cân lại protein sát hơn.';
  const dietNote = isVegetarian ? 'Mình đang ưu tiên lựa chọn phù hợp chế độ ăn chay của bạn.' : '';

  return [
    `Mình chưa thấy thực đơn chi tiết hôm nay trong Fitly, nhưng có thể gợi ý ${mealDisplayLabel} theo hồ sơ hiện tại:`,
    options.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    [goalNote, calorieNote, proteinNote, dietNote].filter(Boolean).join(' '),
  ].join('\n\n');
};

const buildPlanOverviewReply = (message: string, context?: AIChatContext): string => {
  const normalized = normalizeVietnameseText(message);
  const dayLabel = context?.targetDayLabel || 'Hom nay';
  const exercises = Array.isArray(context?.exercises) ? context.exercises : [];
  const meals = Array.isArray(context?.meals) ? context.meals : [];
  const wantsWorkout =
    normalized.includes('bai tap') ||
    normalized.includes('tap gi') ||
    normalized.includes('workout') ||
    normalized.includes('lich tap');
  const wantsMeal =
    normalized.includes('thuc don') ||
    normalized.includes('mon an') ||
    normalized.includes('mon') ||
    normalized.includes('bua') ||
    normalized.includes('an gi') ||
    normalized.includes('protein') ||
    normalized.includes('meal');
  const wantsPlanDetails =
    normalized.includes('xem lich') ||
    normalized.includes('lich hom nay') ||
    normalized.includes('hom nay co') ||
    normalized.includes('co nhung') ||
    normalized.includes('gom nhung') ||
    normalized.includes('bao nhieu bai') ||
    normalized.includes('bao nhieu mon') ||
    normalized.includes('xem bai tap') ||
    normalized.includes('xem thuc don');

  const includeWorkout = wantsPlanDetails || wantsWorkout || (!wantsMeal && exercises.length > 0);
  const includeMeal = wantsPlanDetails || wantsMeal || (!wantsWorkout && meals.length > 0);
  const sections: string[] = [];

  if (includeWorkout) {
    if (exercises.length > 0) {
      const lines = exercises
        .slice(0, 5)
        .map((exercise, index) => {
          const parts = [
            `${index + 1}. ${exercise.name || 'Bai tap'}`,
            `${Number(exercise.sets || 3)} set x ${exercise.reps || '8-12'}`,
          ];
          if (Number(exercise.rest_seconds || 0) > 0) {
            parts.push(`nghi ${Number(exercise.rest_seconds)}s`);
          }
          return parts.join(' - ');
        })
        .join('\n');
      sections.push(`${dayLabel} co ${exercises.length} bai tap:\n${lines}`);
    } else {
      sections.push(`${dayLabel} hien chua co bai tap nao trong lich.`);
    }
  }

  if (includeMeal) {
    if (meals.length > 0) {
      const lines = meals
        .slice(0, 5)
        .map((meal, index) => {
          const calories = formatMealCalories(meal);
          const quantity = Number(meal.quantity || 1);
          return `${index + 1}. ${getMealTypeLabel(meal.meal_type)} - ${meal.name || 'Món ăn'} x${quantity} (${calories} kcal)`;
        })
        .join('\n');
      sections.push(`${dayLabel} có ${meals.length} món ăn:\n${lines}`);
    } else {
      sections.push(buildNoMealPlanSuggestionReply(message, context));
    }
  }

  if (sections.length === 0) {
    return `${dayLabel} hiện chưa có dữ liệu workout hoặc meal plan. Bạn có thể yêu cầu tạo lại lịch hoặc nói rõ mục tiêu hôm nay để mình gợi ý theo tình huống.`;
  }

  return sections.join('\n\n');
};

const buildInjuryCareReply = (): string =>
  [
    'Nếu bạn đang đau, sưng, tê, choáng váng, hoặc có dấu hiệu chấn thương rõ, hãy ưu tiên an toàn trước và tạm dừng các bài tập tác động mạnh ngay lúc này.',
    'Cách xử lý mức cơ bản: nghỉ ngơi, chườm lạnh 15-20 phút mỗi lần, băng ép nhẹ nếu có sưng, kê cao vùng bị đau, và tránh các động tác gây tăng đau.',
    'Nếu đau tăng, không chịu lực được, sưng bầm tím rõ, tê, biến dạng khớp, choáng váng, hoặc sau 2-3 ngày không giảm, bạn nên đi khám cơ xương khớp hoặc y tế thể thao.',
  ].join('\n\n');

const buildRecoveryReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hôm nay';
  const exercises = Array.isArray(context?.exercises) ? context.exercises : [];
  const meals = Array.isArray(context?.meals) ? context.meals : [];

  if (exercises.length > 0) {
    const firstExercise = exercises[0];
    const restSeconds = Math.max(75, Number(firstExercise?.rest_seconds || 60));
    return [
      `${dayLabel} nếu bạn thấy mệt, ưu tiên giảm 1 set mỗi bài, giữ kỹ thuật sạch, và tăng thời gian nghỉ lên khoảng ${restSeconds} giây.`,
      'Sau buổi tập, nên bù protein, bù nước, đi bộ nhẹ 5-10 phút, và ngủ đủ. Nếu muốn, mình có thể rút gọn buổi tập hôm nay thành phiên bản dễ phục hồi hơn.',
    ].join('\n\n');
  }

  if (meals.length > 0) {
    return [
      `${dayLabel} bạn có thể ưu tiên phục hồi bằng cách giữ đủ protein, thêm nước, rau, và một nguồn tinh bột vừa phải quanh buổi tập.`,
      'Nếu bạn muốn, mình có thể gợi ý một bữa gọn hơn nhưng vẫn hỗ trợ phục hồi tốt.',
    ].join('\n\n');
  }

  return [
    `${dayLabel} mình chưa thấy đủ workout hoặc meal plan cụ thể, nên ưu tiên phục hồi cơ bản: ngủ đủ, uống nước, ăn đủ protein, và vận động nhẹ trong ngưỡng dễ chịu.`,
    'Nếu bạn nói rõ đang mệt, đau cơ, hay muốn nhẹ buổi tập, mình sẽ gợi ý sát hơn.',
  ].join('\n\n');
};

const buildMotivationReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hôm nay';
  const workoutCount = Number(context?.todayWorkoutCount || 0);
  const mealCount = Number(context?.todayMealCount || 0);

  if (workoutCount > 0) {
    return [
      `Nếu ${dayLabel.toLowerCase()} bạn đang lười hoặc mất nhịp, đừng nghĩ đến cả buổi tập. Chỉ cần bắt đầu bằng 10 phút đầu tiên hoặc 1 bài đầu tiên.`,
      'Hoàn thành điểm bắt đầu đó trước, sau đó mới quyết định có tập tiếp hay không. Nếu bạn muốn, mình có thể rút gọn buổi hôm nay để dễ vào nhịp hơn.',
    ].join('\n\n');
  }

  if (mealCount > 0) {
    return [
      `Nếu bạn dễ bỏ bữa hoặc không muốn ăn theo kế hoạch ${dayLabel.toLowerCase()}, hãy giữ mục tiêu nhỏ: ăn đúng 1 bữa chính hoặc giữ đủ protein cho bữa sắp tới.`,
      'Chỉ cần bám sát một điểm nhỏ hôm nay là đủ để giữ nhịp. Nếu cần, mình có thể đổi sang lựa chọn gọn hơn.',
    ].join('\n\n');
  }

  return [
    'Nếu hôm nay bạn mất động lực, đừng ép bản thân vào mục tiêu quá lớn. Chọn 1 việc rất nhỏ để bắt đầu: đi bộ 10 phút, uống nước, hoặc ăn đúng 1 bữa.',
    'Sau khi làm xong việc nhỏ đó, mình có thể giúp bạn lên bước tiếp theo.',
  ].join('\n\n');
};

const buildGeneralHealthReply = (context?: AIChatContext): string => {
  const dayLabel = context?.targetDayLabel || 'Hôm nay';
  const todayWorkoutCount = Number(context?.todayWorkoutCount || 0);
  const todayMealCount = Number(context?.todayMealCount || 0);
  const notes = Array.isArray(context?.progressSummary?.planFitNotes)
    ? context.progressSummary.planFitNotes.slice(0, 3)
    : [];

  if (todayWorkoutCount + todayMealCount > 0) {
    const personalCue = notes.length ? ` Điểm mình sẽ bám theo: ${notes.join('; ')}.` : '';
    return `${dayLabel} hiện có ${todayWorkoutCount} bài tập và ${todayMealCount} món ăn.${personalCue} Bạn có thể hỏi rõ hơn về workout, meal plan, phục hồi, giảm mệt, hoặc cách bám sát mục tiêu hôm nay.`;
  }

  const personalCue = notes.length ? ` Mình sẽ tạm dựa trên: ${notes.join('; ')}.` : '';
  return `${dayLabel} mình chưa thấy đủ lịch tập hoặc thực đơn.${personalCue} Bạn có thể hỏi về dinh dưỡng, phục hồi, hoặc yêu cầu tạo lại kế hoạch để mình hỗ trợ sát hơn.`;
};

const buildOutOfScopeReply = (): string =>
  'Mình tập trung vào workout, meal plan, phục hồi, và thói quen sức khỏe. Nếu bạn cần, hãy hỏi mình về buổi tập hôm nay, thực đơn, giảm mệt, phục hồi, hoặc cách giữ động lực.';

const getFallbackReply = (message: string, intent: AIIntent, context?: AIChatContext): string => {
  if (isGreetingMessage(message)) return buildGreetingReply(context);
  if (isDailyCalorieQuestion(message)) return buildDailyCalorieTargetReply(context);

  const previousTopic = getPreviousTopic(context?.chatHistory);
  if (isShortFollowUpMessage(message)) {
    if (previousTopic === 'workout') return buildPlanOverviewReply('bai tap hom nay', context);
    if (previousTopic === 'meal') return buildPlanOverviewReply('thuc don hom nay', context);
  }

  if (intent === 'injury_care') return buildInjuryCareReply();
  if (intent === 'recovery') return buildRecoveryReply(context);
  if (intent === 'motivation') return buildMotivationReply(context);
  if (intent === 'out_of_scope') return buildOutOfScopeReply();
  if (intent === 'workout_plan' || intent === 'meal_plan' || intent === 'view_day_plan') {
    return buildPlanOverviewReply(message, context);
  }
  return buildGeneralHealthReply(context);
};

const getIntentConfidence = (intent: AIIntent): number => {
  if (intent === 'injury_care') return 0.92;
  if (intent === 'motivation') return 0.88;
  if (intent === 'recovery') return 0.84;
  if (intent === 'out_of_scope') return 0.84;
  if (intent === 'workout_plan' || intent === 'meal_plan' || intent === 'view_day_plan') return 0.82;
  return 0.7;
};

export const aiChatService = async (
  message: string,
  detectedIntent: AIIntent,
  context?: AIChatContext,
): Promise<AIChatResponse> => {
  const responseMode = getResponseModeForIntent(detectedIntent);

  if (isDailyCalorieQuestion(message)) {
    return {
      reply: buildDailyCalorieTargetReply(context),
      intent: detectedIntent === 'general_health' ? 'meal_plan' : detectedIntent,
      responseMode: 'coach_advice',
      confidence: 0.9,
      actionRequired: false,
      actionType: null,
      actionPayload: null,
    };
  }

  if (detectedIntent === 'injury_care' || detectedIntent === 'out_of_scope') {
    return {
      reply: getFallbackReply(message, detectedIntent, context),
      intent: detectedIntent,
      responseMode,
      confidence: getIntentConfidence(detectedIntent),
      actionRequired: false,
      actionType: null,
      actionPayload: null,
    };
  }

  try {
    const aiReply = await askFitlyCoach({
      userMessage: message,
      context: {
        ...context,
        platform: 'web',
        detectedIntent,
        responseMode,
      },
      history: context?.chatHistory,
      maxTokens: 1024,
      temperature: detectedIntent === 'motivation' ? 0.75 : 0.6,
    });

    if (aiReply) {
      return {
        reply: aiReply,
        intent: detectedIntent,
        responseMode,
        confidence: getIntentConfidence(detectedIntent),
        actionRequired: false,
        actionType: null,
        actionPayload: null,
      };
    }
  } catch (error: any) {
    console.warn('[aiChatService] Groq chat fallback:', error?.message || error);
  }

  return {
    reply: getFallbackReply(message, detectedIntent, context),
    intent: detectedIntent,
    responseMode,
    confidence: getIntentConfidence(detectedIntent),
    actionRequired: false,
    actionType: null,
    actionPayload: null,
  };
};
