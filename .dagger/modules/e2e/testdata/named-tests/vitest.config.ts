// An inline Vitest project, so `vitest list` prefixes its lines with [unit].
export default {
  test: {
    projects: [{ test: { name: 'unit' } }],
  },
}
