import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url))).expo;
const errors = [];
const production = process.argv.includes('--production') || process.env.EXPO_PUBLIC_RELEASE_CHANNEL === 'production';
if (!config.ios.bundleIdentifier || !config.android.package) errors.push('Thiếu bundle ID hoặc Android package.');
if (!config.android.blockedPermissions.includes('android.permission.RECORD_AUDIO')) errors.push('Quyền micro chưa dùng phải được loại khỏi bản phát hành.');
if (production) {
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_API_URL']) {
    const value = process.env[name] || '';
    if (!/^https:\/\//.test(value) || /localhost|127\.0\.0\.1|example\.|\.invalid/.test(value)) errors.push(`${name} cần URL HTTPS của môi trường phát hành.`);
  }
  if (!process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) errors.push('Thiếu khóa Supabase publishable.');
  const platforms = process.env.EAS_BUILD_PLATFORM ? [process.env.EAS_BUILD_PLATFORM] : ['ios', 'android'];
  for (const platform of platforms) {
    const name = platform === 'ios' ? 'EXPO_PUBLIC_REVENUECAT_IOS_KEY' : 'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY';
    const prefix = platform === 'ios' ? 'appl_' : 'goog_';
    if (!process.env[name]?.startsWith(prefix)) errors.push(`${name} cần khóa public của ứng dụng trên cửa hàng tương ứng.`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(production ? 'Cấu hình build production hợp lệ. Vẫn cần kiểm thử và khai báo trên hai cửa hàng.' : 'Cấu hình cơ bản hợp lệ. Dùng --production để kiểm tra biến môi trường phát hành.');
