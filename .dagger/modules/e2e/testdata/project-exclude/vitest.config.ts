// An inline Vitest project with its own exclude, which overrides --exclude.
export default {
  test: {
    projects: [{ test: { name: 'unit', exclude: ['**/node_modules/**'] } }],
  },
}
