# Codex task: Đổi mức độ bài tập sang easy / medium / hard và cập nhật catalog 100 bài

Bạn đang làm việc trong repository Fitly.

File SQL mới được cung cấp:

```text
fitly_exercise_catalog_100_easy_medium_hard.sql
```

Hãy đặt file vào vị trí phù hợp, ví dụ:

```text
supabase/seeds/fitly_exercise_catalog_100_easy_medium_hard.sql
```

## Mục tiêu

Đổi taxonomy mức độ bài tập trong toàn dự án từ:

```text
absolute_beginner
beginner
beginner_plus
```

sang:

```text
easy
medium
hard
```

Nhãn hiển thị tiếng Việt:

```text
easy   -> Dễ
medium -> Trung bình
hard   -> Khó
```

Mapping bắt buộc cho 100 bài chính thức:

```text
absolute_beginner -> easy
beginner          -> medium
beginner_plus     -> hard
```

Không đổi ID bài tập. Không đổi progression level. Không bỏ `min_experience_months`.

---

## 1. Audit trước khi sửa

Tìm toàn bộ nơi đang dùng:

```text
absolute_beginner
beginner
beginner_plus
easy
medium
hard
difficulty
min_experience_months
```

Kiểm tra tối thiểu:

- `shared/exerciseCatalog.ts`
- backend exercise catalog service
- AI Coach validation/filtering
- weekly plan generation
- validator và upsert script
- Admin exercise CRUD
- Exercise Details và overlay
- tests
- migrations/seeds
- documentation

Phân biệt rõ:

- exercise difficulty
- profile/user experience level

Không thay nhầm giá trị experience của người dùng chỉ vì có chữ `beginner`.

---

## 2. Canonical taxonomy mới

Cập nhật shared type tương đương:

```ts
export const EXERCISE_DIFFICULTIES = [
  'easy',
  'medium',
  'hard',
] as const;

export type ExerciseDifficulty =
  typeof EXERCISE_DIFFICULTIES[number];
```

Tạo label map dùng chung:

```ts
export const EXERCISE_DIFFICULTY_LABELS = {
  easy: 'Dễ',
  medium: 'Trung bình',
  hard: 'Khó',
} as const;
```

Không hiển thị raw key trong UI.

---

## 3. Backward-compatible normalization

Dữ liệu cũ có thể vẫn chứa:

```text
absolute_beginner
beginner
beginner_plus
novice
intermediate
advanced
easy
medium
hard
```

Cập nhật normalization theo mapping:

```text
absolute_beginner -> easy
beginner          -> medium
beginner_plus     -> hard
novice            -> easy
intermediate      -> medium
advanced          -> hard
easy              -> easy
medium            -> medium
hard              -> hard
```

Giữ các alias cũ đã được xác nhận trong repo.

Với giá trị không xác định:

- không được mặc định thành `easy`;
- trả `null` để validator reject, hoặc dùng `hard` tại application layer nếu contract hiện tại bắt buộc có giá trị;
- ghi rõ behavior đã chọn.

Không dùng substring matching thiếu kiểm soát.

---

## 4. Migration database

Không sửa migration đã apply.

Tạo migration timestamp mới để chuyển dữ liệu cũ:

```sql
UPDATE public.exercises
SET difficulty = CASE
  WHEN difficulty = 'absolute_beginner' THEN 'easy'
  WHEN difficulty = 'beginner' THEN 'medium'
  WHEN difficulty = 'beginner_plus' THEN 'hard'
  WHEN difficulty = 'novice' THEN 'easy'
  WHEN difficulty = 'intermediate' THEN 'medium'
  WHEN difficulty = 'advanced' THEN 'hard'
  ELSE difficulty
END
WHERE difficulty IN (
  'absolute_beginner',
  'beginner',
  'beginner_plus',
  'novice',
  'intermediate',
  'advanced'
);
```

Điều chỉnh theo schema thực tế.

Nếu có CHECK constraint cho difficulty:

1. Xác định đúng tên constraint.
2. Normalize dữ liệu trước.
3. Thay bằng constraint chỉ chấp nhận:

```sql
difficulty IS NULL
OR difficulty IN ('easy', 'medium', 'hard')
```

Nếu cột đang `NOT NULL`, giữ nguyên nullability và dùng constraint tương ứng.

Migration phải:

- giữ nguyên exercise ID;
- không xóa exercise;
- không phá weekly plan, history hoặc set logs;
- không đổi foreign key;
- an toàn khi chạy lại ở mức dữ liệu;
- chỉ cập nhật `updated_at` theo convention hiện có.

---

## 5. Catalog 100 bài mới

Dùng file:

```text
fitly_exercise_catalog_100_easy_medium_hard.sql
```

Không tự sinh lại nội dung.

Xác minh:

- đúng 100 ID duy nhất;
- mọi difficulty chỉ là `easy`, `medium`, `hard`;
- không còn `absolute_beginner`, `beginner`, `beginner_plus`;
- `min_experience_months` không bị thay đổi;
- progression references vẫn hợp lệ;
- instructions và metadata giữ nguyên;
- không thêm URL ảnh/GIF giả.

Import qua flow seed/migration an toàn hiện có.

Không tự động apply production.

---

## 6. Eligibility logic

Giữ nguyên hard rule:

```ts
context.experienceMonths >= exercise.min_experience_months
```

Không thay bằng logic dựa duy nhất vào difficulty.

Difficulty chỉ dùng cho:

- hiển thị;
- filter;
- sắp xếp;
- soft ranking.

Difficulty không được override:

- location;
- equipment;
- contraindications;
- safety guard;
- `min_experience_months`.

Nếu cần numeric rank:

```ts
const DIFFICULTY_RANK = {
  easy: 1,
  medium: 2,
  hard: 3,
};
```

Không dựa vào thứ tự alphabet.

---

## 7. Frontend

Cập nhật mọi nơi hiển thị hoặc chọn difficulty:

```text
Dễ
Trung bình
Khó
```

Kiểm tra:

- Admin create/edit exercise
- Exercise Details
- Exercise detail overlay
- workout exercise chip nếu có
- Admin filter
- tests/snapshots

Không đưa lại giao diện public “Khám phá bài tập” vào `Exercises.tsx`.

Trang Exercises của người dùng vẫn chỉ hiển thị lịch tập cá nhân hóa.

Không đổi profile experience level nếu không thuộc exercise difficulty.

---

## 8. Admin

Select difficulty phải có đúng ba lựa chọn:

```text
Dễ          (easy)
Trung bình  (medium)
Khó         (hard)
```

Khi mở record legacy:

- normalize giá trị cũ;
- hiển thị label tiếng Việt mới;
- khi lưu chỉ ghi key canonical mới.

Không cho nhập difficulty bằng free text.

---

## 9. Validator và importer

Official catalog schema chỉ được chấp nhận:

```text
easy
medium
hard
```

Validator phải reject các giá trị cũ trong catalog mới:

```text
absolute_beginner
beginner
beginner_plus
```

Backward compatibility chỉ nằm ở migration/normalization, không nằm trong contract catalog mới.

Báo cáo validator phải thống kê:

```text
easy
medium
hard
```

Upsert script không được đổi ngược sang key cũ.

---

## 10. AI Coach và weekly plan

Cập nhật enum/schema/prompt AI có liên quan đến difficulty.

AI metadata phải dùng:

```text
easy
medium
hard
```

Prompt có thể diễn giải:

```text
easy = Dễ
medium = Trung bình
hard = Khó
```

Vẫn truyền `min_experience_months` cho AI.

Không để AI dùng difficulty thay cho hard eligibility filtering.

Apply endpoint vẫn phải revalidate toàn bộ proposal.

---

## 11. Tests

Thêm hoặc cập nhật test:

1. `absolute_beginner` -> `easy`.
2. `beginner` -> `medium`.
3. `beginner_plus` -> `hard`.
4. `novice` -> `easy`.
5. `intermediate` -> `medium`.
6. `advanced` -> `hard`.
7. Unknown difficulty không trở thành `easy`.
8. Catalog chính thức reject key cũ.
9. Catalog chính thức chỉ nhận `easy`, `medium`, `hard`.
10. Cả 100 bài dùng taxonomy mới.
11. Eligibility vẫn dùng `min_experience_months`.
12. Bài `hard` có `min_experience_months = 3` vẫn hợp lệ cho user 4 tháng nếu các điều kiện khác đạt.
13. Bài `easy` vẫn bị reject nếu `min_experience_months` cao hơn kinh nghiệm user.
14. Admin hiển thị tiếng Việt nhưng lưu key tiếng Anh.
15. Workout history legacy vẫn resolve được.

---

## 12. Documentation

Cập nhật:

- exercise catalog design
- import guide
- README/example commands
- taxonomy tables
- Admin documentation nếu có

Ghi rõ:

```text
easy   = Dễ
medium = Trung bình
hard   = Khó
```

Và:

- difficulty là nhãn mô tả;
- `min_experience_months` mới là hard eligibility rule;
- key cũ chỉ được normalize để backward compatibility.

---

## 13. Commands

Chạy tối thiểu:

```bash
cd Backend
npm run exercises:validate -- --file <revised-official-catalog> --expected-count 100
npm test
npm run typecheck
npm run build
```

```bash
cd Frontend
npm run lint
npm run build
```

Nếu môi trường hỗ trợ, chạy Supabase migration/database lint trên local hoặc staging.

Sau migration/import, query:

```sql
SELECT difficulty, count(*)
FROM public.exercises
GROUP BY difficulty
ORDER BY difficulty;
```

Và:

```sql
SELECT count(*)
FROM public.exercises
WHERE difficulty IN (
  'absolute_beginner',
  'beginner',
  'beginner_plus'
);
```

Trong 100 official IDs, query thứ hai phải trả `0`.

---

## 14. Báo cáo cuối

Trả về:

### Audit
- Các file từng dùng key cũ.
- Phân biệt exercise difficulty và profile experience.

### Migration
- Path migration mới.
- Số row được convert theo từng mapping.
- Constraint đã đổi.

### Catalog
- Path SQL mới.
- Số lượng `easy`, `medium`, `hard`.
- Xác minh đủ 100 official IDs.

### Backend
- Normalization.
- Eligibility.
- AI/weekly-plan schemas.

### Frontend
- Admin options.
- Label tiếng Việt.
- Detail display.

### Tests and commands
Ghi chính xác command và kết quả thật.

### Files changed
Liệt kê từng file.

### Remaining limitations
Chỉ nêu giới hạn thực tế.

Không tuyên bố production đã thay đổi nếu chưa apply và query xác minh.
