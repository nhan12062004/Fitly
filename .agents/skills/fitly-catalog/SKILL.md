---
name: fitly-catalog
description: "Quy chuẩn quản lý dữ liệu danh mục bài tập (Exercise Catalog) và công thức món ăn (Recipe Catalog) trong Fitly."
---

# Fitly Catalog Management Skill

## Overview
Skill này hướng dẫn quy chuẩn làm việc với Exercise Catalog và Recipe Catalog.

## Rules & Schema Specs

### 1. Exercise Catalog Specs
- Đơn vị độ khó: `easy`, `medium`, `hard`.
- Nhóm cơ chính & phụ (Muscle groups), dụng cụ (Equipment).
- Đính kèm URL video trực tiếp từ Supabase Storage (`exercises` bucket).

### 2. Recipe Catalog Specs
- Định dạng thông số Macros bắt buộc:
  - `calories` (kcal)
  - `protein` (g)
  - `carbs` (g)
  - `fat` (g)
- Đính kèm URL hình ảnh món ăn từ Supabase Storage (`recipes` bucket).
- Khớp chế độ ăn dựa trên `dietaryPreferences.ts`.

### 3. Workflow Cập nhật Danh mục
- Luôn cập nhật tại `/shared` để cả Frontend và Backend dùng chung.
- Đảm bảo dữ liệu không bị xung đột ID giữa các bài tập/món ăn.
