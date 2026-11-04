export const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY34679'
export const normaliseCode = (typed: string) => typed.replace(/[^A-Z0-9]/gi, '').toUpperCase()
