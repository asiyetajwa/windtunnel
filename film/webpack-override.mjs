// The film imports the app's simulator from ../src/sim, whose TypeScript imports use NodeNext ".js" specifiers.
export const webpackOverride = (config) => ({
  ...config,
  resolve: { ...config.resolve, extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
});
