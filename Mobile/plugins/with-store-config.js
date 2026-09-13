const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withStoreConfig(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'false';
      const main = application.activity?.find((activity) => activity.$['android:name'] === '.MainActivity');
      // Keep bank/store verification returning to the purchase activity.
      if (main) main.$['android:launchMode'] = 'singleTop';
    }
    return config;
  });
};
