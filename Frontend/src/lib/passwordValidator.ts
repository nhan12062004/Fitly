export interface PasswordValidationResult {
  minLength: boolean;
  hasLower: boolean;
  hasUpper: boolean;
  hasNumber: boolean;
  isValid: boolean;
}

export function validatePassword(password: string): PasswordValidationResult {
  const minLength = password.length >= 8;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  return {
    minLength,
    hasLower,
    hasUpper,
    hasNumber,
    isValid: minLength && hasLower && hasUpper && hasNumber,
  };
}

export function parsePasswordError(errorMessage: string): string {
  if (!errorMessage) return '';
  if (errorMessage === 'Invalid login credentials') {
    return 'Email hoặc mật khẩu không chính xác';
  }
  if (errorMessage === 'User already registered') {
    return 'Email này đã được đăng ký';
  }
  if (errorMessage.includes('Password should be at least')) {
    return 'Mật khẩu phải có ít nhất 8 ký tự';
  }
  if (
    errorMessage.includes('Password should contain') ||
    errorMessage.toLowerCase().includes('weak password')
  ) {
    return 'Mật khẩu phải thỏa mãn đủ các điều kiện: ít nhất 8 ký tự, gồm chữ thường, chữ hoa và chữ số';
  }
  if (errorMessage === 'Email not confirmed') {
    return 'Vui lòng xác nhận email trước khi đăng nhập';
  }
  return errorMessage;
}
