export function getVietnameseAuthError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('invalid login credentials')) return 'Email hoặc mật khẩu chưa đúng.';
  if (message.includes('email not confirmed')) return 'Hãy xác thực email trước khi đăng nhập.';
  if (message.includes('user already registered')) return 'Email này đã được đăng ký.';
  if (message.includes('password should be at least')) return 'Mật khẩu chưa đáp ứng yêu cầu bảo mật.';
  if (message.includes('rate limit')) return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
  if (message.includes('network') || message.includes('fetch')) return 'Không thể kết nối máy chủ. Hãy kiểm tra mạng rồi thử lại.';
  return fallback;
}
