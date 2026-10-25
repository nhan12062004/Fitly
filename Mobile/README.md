# Fitly Mobile

Ứng dụng Expo cho iOS và Android. Cấu hình ứng dụng, biểu tượng và splash screen nằm trong `app.json`.

## Chạy tại máy

```bash
npm ci
```

Sao chép `.env.example` thành `.env` và điền URL Supabase, API cùng các khóa public cần dùng. Sau đó chạy:

```bash
npm start
```

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm run check:release
```

`check:release` được chạy trong CI và sau khi cài đặt trên EAS Build. Tài nguyên thương hiệu đang dùng được khai báo trong `app.json`.
